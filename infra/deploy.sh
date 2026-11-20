#!/usr/bin/env bash
set -euo pipefail

# AegisLLM Live AWS CloudShell Deployment Script (Free Tier Friendly)
# Provisions:
#   1. Amazon S3 Bucket (Signed ECDSA P-256 rule packs + CORS + public read on rule_packs/*)
#   2. Amazon DynamoDB Table (AegisTelemetry)
#   3. IAM Role (AegisTelemetryLambdaRole) with least-privilege DynamoDB access
#   4. AWS Lambda Function (aegis-telemetry-ingestion, nodejs20.x)
#   5. Amazon API Gateway HTTP API (AegisTelemetryApi, POST /telemetry/event + CORS, stage prod)

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region || true)}}"
REGION="${REGION:-us-east-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="aegis-llm-rules-${ACCOUNT_ID}-${REGION}"
TABLE_NAME="AegisTelemetry"
ROLE_NAME="AegisTelemetryLambdaRole"
FUNCTION_NAME="aegis-telemetry-ingestion"
API_NAME="AegisTelemetryApi"

echo "=================================================================="
echo " AegisLLM AWS Deployment"
echo " Account : ${ACCOUNT_ID}"
echo " Region  : ${REGION}"
echo " Bucket  : ${BUCKET}"
echo "=================================================================="

# ------------------------------------------------------------------
# 1. Amazon S3 Bucket + CORS + Public Read Policy + Rule Pack Upload
# ------------------------------------------------------------------
echo "[1/5] Provisioning S3 bucket ${BUCKET}..."
if aws s3api head-bucket --bucket "${BUCKET}" 2>/dev/null; then
  echo "  -> Bucket already exists."
else
  if [ "${REGION}" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}"
  else
    aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}" \
      --create-bucket-configuration "LocationConstraint=${REGION}"
  fi
fi

aws s3api put-public-access-block --bucket "${BUCKET}" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"

cat > /tmp/s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadRulePacksOnly",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${BUCKET}/rule_packs/*"
    }
  ]
}
EOF
aws s3api put-bucket-policy --bucket "${BUCKET}" --policy file:///tmp/s3-policy.json

cat > /tmp/s3-cors.json <<EOF
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedOrigins": ["*"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF
aws s3api put-bucket-cors --bucket "${BUCKET}" --cors-configuration file:///tmp/s3-cors.json

aws s3 cp rule_packs/rules.v1.json "s3://${BUCKET}/rule_packs/rules.v1.json" \
  --content-type "application/json" --region "${REGION}"
aws s3 cp rule_packs/rules.v1.json.sig "s3://${BUCKET}/rule_packs/rules.v1.json.sig" \
  --content-type "text/plain" --region "${REGION}"

S3_RULES_URL="https://${BUCKET}.s3.${REGION}.amazonaws.com/rule_packs/rules.v1.json"
S3_SIG_URL="https://${BUCKET}.s3.${REGION}.amazonaws.com/rule_packs/rules.v1.json.sig"

# ------------------------------------------------------------------
# 2. Amazon DynamoDB Table (AegisTelemetry)
# ------------------------------------------------------------------
echo "[2/5] Provisioning DynamoDB table ${TABLE_NAME}..."
if aws dynamodb describe-table --table-name "${TABLE_NAME}" --region "${REGION}" >/dev/null 2>&1; then
  echo "  -> Table ${TABLE_NAME} already exists."
else
  aws dynamodb create-table \
    --table-name "${TABLE_NAME}" \
    --attribute-definitions \
      AttributeName=detectorType_date,AttributeType=S \
      AttributeName=userAction,AttributeType=S \
    --key-schema \
      AttributeName=detectorType_date,KeyType=HASH \
      AttributeName=userAction,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --tags Key=Project,Value=AegisLLM Key=Environment,Value=Production \
    --region "${REGION}" >/dev/null
  echo "  -> Waiting for table to become ACTIVE..."
  aws dynamodb wait table-exists --table-name "${TABLE_NAME}" --region "${REGION}"
fi

aws dynamodb update-time-to-live \
  --table-name "${TABLE_NAME}" \
  --time-to-live-specification "Enabled=true,AttributeName=ttl" \
  --region "${REGION}" >/dev/null 2>&1 || true

TABLE_ARN="arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TABLE_NAME}"

# ------------------------------------------------------------------
# 3. IAM Execution Role for Lambda
# ------------------------------------------------------------------
echo "[3/5] Ensuring IAM role ${ROLE_NAME}..."
cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

CREATED_ROLE=0
if aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  echo "  -> IAM role ${ROLE_NAME} already exists."
else
  aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document file:///tmp/trust-policy.json >/dev/null
  CREATED_ROLE=1
fi

aws iam attach-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

cat > /tmp/ddb-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AegisTelemetryDynamoWrite",
      "Effect": "Allow",
      "Action": [
        "dynamodb:UpdateItem",
        "dynamodb:GetItem",
        "dynamodb:Scan"
      ],
      "Resource": "${TABLE_ARN}"
    }
  ]
}
EOF
aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name AegisTelemetryDynamoPolicy \
  --policy-document file:///tmp/ddb-policy.json

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
if [ "${CREATED_ROLE}" -eq 1 ]; then
  echo "  -> Waiting 10s for IAM role propagation..."
  sleep 10
fi

# ------------------------------------------------------------------
# 4. AWS Lambda Function (aegis-telemetry-ingestion)
# ------------------------------------------------------------------
echo "[4/5] Deploying Lambda function ${FUNCTION_NAME}..."
rm -f /tmp/lambda-function.zip
(cd lambda && zip -q /tmp/lambda-function.zip telemetry_handler.js)

if aws lambda get-function --function-name "${FUNCTION_NAME}" --region "${REGION}" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --function-name "${FUNCTION_NAME}" \
    --zip-file fileb:///tmp/lambda-function.zip \
    --region "${REGION}" >/dev/null
  aws lambda wait function-updated --function-name "${FUNCTION_NAME}" --region "${REGION}"
  aws lambda update-function-configuration \
    --function-name "${FUNCTION_NAME}" \
    --runtime nodejs20.x \
    --handler telemetry_handler.handler \
    --environment "Variables={TELEMETRY_TABLE=${TABLE_NAME}}" \
    --region "${REGION}" >/dev/null
else
  aws lambda create-function \
    --function-name "${FUNCTION_NAME}" \
    --runtime nodejs20.x \
    --architectures arm64 \
    --role "${ROLE_ARN}" \
    --handler telemetry_handler.handler \
    --zip-file fileb:///tmp/lambda-function.zip \
    --timeout 5 \
    --memory-size 256 \
    --environment "Variables={TELEMETRY_TABLE=${TABLE_NAME}}" \
    --region "${REGION}" >/dev/null
  aws lambda wait function-active-v2 --function-name "${FUNCTION_NAME}" --region "${REGION}"
fi

LAMBDA_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"

# ------------------------------------------------------------------
# 5. Amazon API Gateway HTTP API (POST /telemetry/event)
# ------------------------------------------------------------------
echo "[5/5] Configuring API Gateway HTTP API (${API_NAME})..."
API_ID="$(aws apigatewayv2 get-apis --region "${REGION}" \
  --query "Items[?Name=='${API_NAME}'].ApiId | [0]" --output text)"

if [ -z "${API_ID}" ] || [ "${API_ID}" = "None" ]; then
  API_ID="$(aws apigatewayv2 create-api \
    --name "${API_NAME}" \
    --protocol-type HTTP \
    --cors-configuration 'AllowOrigins=["*"],AllowMethods=["POST","OPTIONS"],AllowHeaders=["content-type","x-api-key","authorization","x-amz-date"]' \
    --region "${REGION}" \
    --query ApiId --output text)"
fi

INTEGRATION_ID="$(aws apigatewayv2 get-integrations --api-id "${API_ID}" --region "${REGION}" \
  --query 'Items[0].IntegrationId' --output text)"

if [ -z "${INTEGRATION_ID}" ] || [ "${INTEGRATION_ID}" = "None" ]; then
  INTEGRATION_ID="$(aws apigatewayv2 create-integration \
    --api-id "${API_ID}" \
    --integration-type AWS_PROXY \
    --integration-uri "${LAMBDA_ARN}" \
    --payload-format-version 2.0 \
    --region "${REGION}" \
    --query IntegrationId --output text)"
fi

EXISTING_ROUTE="$(aws apigatewayv2 get-routes --api-id "${API_ID}" --region "${REGION}" \
  --query "Items[?RouteKey=='POST /telemetry/event'].RouteId | [0]" --output text)"

if [ -z "${EXISTING_ROUTE}" ] || [ "${EXISTING_ROUTE}" = "None" ]; then
  aws apigatewayv2 create-route \
    --api-id "${API_ID}" \
    --route-key "POST /telemetry/event" \
    --target "integrations/${INTEGRATION_ID}" \
    --region "${REGION}" >/dev/null
fi

EXISTING_STAGE="$(aws apigatewayv2 get-stages --api-id "${API_ID}" --region "${REGION}" \
  --query "Items[?StageName=='prod'].StageName | [0]" --output text)"

if [ -z "${EXISTING_STAGE}" ] || [ "${EXISTING_STAGE}" = "None" ]; then
  aws apigatewayv2 create-stage \
    --api-id "${API_ID}" \
    --stage-name prod \
    --auto-deploy \
    --region "${REGION}" >/dev/null
fi

aws lambda add-permission \
  --function-name "${FUNCTION_NAME}" \
  --statement-id "AllowApiGatewayInvoke-${API_ID}" \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*" \
  --region "${REGION}" >/dev/null 2>&1 || true

TELEMETRY_API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/prod/telemetry/event"

# ------------------------------------------------------------------
# Live End-to-End Smoke Verification
# ------------------------------------------------------------------
echo ""
echo "[Verify] Testing live S3 rule pack URL..."
curl -sfI "${S3_RULES_URL}" | head -n 1

echo "[Verify] Sending test anonymized telemetry event to API Gateway -> Lambda -> DynamoDB..."
NOW_MS="$(( $(date +%s) * 1000 ))"
SMOKE_RESP="$(curl -sS -X POST "${TELEMETRY_API_URL}" \
  -H "Content-Type: application/json" \
  -d "{\"detectorType\":\"OPENAI_API_KEY\",\"userAction\":\"REDACTED\",\"confidence\":0.99,\"clientTimestamp\":${NOW_MS}}")"
echo "  -> Lambda Response: ${SMOKE_RESP}"

echo "[Verify] Scanning DynamoDB table ${TABLE_NAME}..."
aws dynamodb scan --table-name "${TABLE_NAME}" --region "${REGION}" --max-items 5 --output table

echo ""
echo "=================================================================="
echo " DEPLOYMENT COMPLETE! Copy these 2 URLs:"
echo " S3 Rules URL      : ${S3_RULES_URL}"
echo " S3 Signature URL  : ${S3_SIG_URL}"
echo " Telemetry API URL : ${TELEMETRY_API_URL}"
echo "=================================================================="

