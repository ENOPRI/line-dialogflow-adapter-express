import bodyParser from 'body-parser';
import { config } from 'dotenv';
import express from 'express';
import { get } from 'lodash';
import { Client } from '@line/bot-sdk';

import {
  lineClientConfig,
  dialogflowClientConfig,
  firebaseConfig,
  chatbaseConfig,
  DEFAULT_PORT,
} from './config';

import { DialogflowClient } from './dialogflow-client';
import { EventHandler } from './event-handler';

// ✅ Firebase v9 modular SDK に対応
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set } from 'firebase/database';

config();
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

const app = express();
app.use(bodyParser.json());

const lineClient = new Client(lineClientConfig);
console.log(lineClientConfig);
console.log(dialogflowClientConfig);
console.log(chatbaseConfig);

const dialogflowClient = new DialogflowClient(dialogflowClientConfig);
const webhookHandler = new EventHandler(lineClient, dialogflowClient);

let contextsLoadedTimestamp = {};

app.post('/', async (req, res) => {
  res.status(200).send('OK');

  try {
    const event = get(req, ['body', 'events', '0']);
    const userId = get(event, ['source', 'userId']);
    console.log(event);

    if (
      !contextsLoadedTimestamp[userId] ||
      contextsLoadedTimestamp[userId].getTime() < new Date().getTime() - 1000 * 60 * 60
    ) {
      console.log('Load context from Firebase');

      const snapshot = await get(ref(db, 'contexts/' + userId));
      const contextsFromFirebase = (snapshot.exists() && snapshot.val().contexts) || [];

      for (let i in contextsFromFirebase) {
        await dialogflowClient.createContext(userId, contextsFromFirebase[i]);
      }

      contextsLoadedTimestamp[userId] = new Date();
    }

    await webhookHandler.handleEvent(event);

    const contexts = (await dialogflowClient.listContext(userId)).map((x) => ({
      name: x.name,
      lifespanCount: x.lifespanCount,
    }));

    await set(ref(db, 'contexts/' + userId), { contexts });
  } catch (err) {
    console.error('Webhook internal error:', err);
  }
});

app.listen(process.env.PORT || DEFAULT_PORT);
