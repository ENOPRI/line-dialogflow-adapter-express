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
import * as firebase from 'firebase';

config();
firebase.initializeApp(firebaseConfig);

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
  // ✅ 5秒ルール対応のため、即時応答
  res.status(200).send('OK');

  try {
    const event = get(req, ['body', 'events', '0']);
    const userId = get(event, ['source', 'userId']);
    console.log(event);

    // FirebaseからContextをロード
    if (
      !contextsLoadedTimestamp[userId] ||
      contextsLoadedTimestamp[userId].getTime() < new Date().getTime() - 1000 * 60 * 60
    ) {
      console.log('Load context from Firebase');
      const snapshot = await firebase
        .database()
        .ref('contexts/' + userId)
        .once('value');
      const contextsFromFirebase = (snapshot.val() && snapshot.val().contexts) || [];

      for (let i in contextsFromFirebase) {
        await dialogflowClient.createContext(userId, contextsFromFirebase[i]);
      }

      contextsLoadedTimestamp[userId] = new Date();
    }

    // LINEイベント処理
    await webhookHandler.handleEvent(event);

    // Contextを保存
    const contexts = (await dialogflowClient.listContext(userId)).map((x) => ({
      name: x.name,
      lifespanCount: x.lifespanCount,
    }));

    await firebase.database().ref('contexts/' + userId).set(contexts);
  } catch (err) {
    console.error('Webhook internal error:', err);
  }
});

app.listen(process.env.PORT || DEFAULT_PORT);
