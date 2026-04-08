const express = require('express');
const config = require('./config');
const pubsubRoute = require('./routes/pubsub');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'email-parser' });
});

app.use('/pubsub', pubsubRoute);

app.listen(config.PORT, () => {
  console.log(`email-parser listening on port ${config.PORT}`);
});
