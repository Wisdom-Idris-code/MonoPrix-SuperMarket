import 'dotenv/config';
import { config } from './lib/config.js';
import app from './app.js';

app.listen(config.PORT, () => {
  console.log(`Monoprix API listening on port ${config.PORT}`);
});
