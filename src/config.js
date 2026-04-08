require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 8080,
  GCS_BUCKET: process.env.GCS_BUCKET || 'raw-email-store',
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || 'travel-tracker-9674d',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  PARENT_API_URL: process.env.PARENT_API_URL,
  PARENT_API_KEY: process.env.PARENT_API_KEY,
};
