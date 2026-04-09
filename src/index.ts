import express from 'express';
import config from './config';
import pubsubRoute from './routes/pubsub';

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'email-parser' });
});

app.use('/pubsub', pubsubRoute);

app.listen(config.PORT, () => {
  console.log(`email-parser listening on port ${config.PORT}`);
});
