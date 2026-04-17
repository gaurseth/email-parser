import 'dotenv/config';

export interface Config {
  PORT: number | string;
  GCS_BUCKET: string;
  GCP_PROJECT_ID: string;
  ANTHROPIC_API_KEY: string | undefined;
  PARENT_API_URL: string | undefined;
  PARENT_API_KEY: string | undefined;
}

const config: Config = {
  PORT: process.env.PORT || 8080,
  GCS_BUCKET: process.env.GCS_BUCKET || 'raw-email-store',
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || 'travel-tracker-9674d',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  PARENT_API_URL: process.env.PARENT_API_URL,
  PARENT_API_KEY: process.env.PARENT_API_KEY,
};

export default config;
