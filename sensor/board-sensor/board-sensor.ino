#include <AsyncMqttClient.h>
#include <Env.h>
#include <Evaluation.h>
#include "DHT.h"
#include <WiFi.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#define INIT_MIN_GAS 300 // initial setup for gas playground
#define INIT_MAX_GAS 3500 // initial setup for gas playground
#define INIT_SAMPLE_FREQ 2500 // initial setup for sensors 
#define INIT_AQI -1 // initial setup for gas playground

extern "C" {
#include "freertos/FreeRTOS.h"
#include "freertos/timers.h"
}

// HTTP Server
String url_data = "http://" + String(serverIP) + "/data";
String url_packages_info = "http://" + String(serverIP) + "/info-packages";

// ----------- Topics -----------
const char *sensor_change_vars = "sensor/change/vars"; // setup topic to change metadata
const char *sensor_change_prot = "sensor/change/prot"; // richiesta di switching di protocollo
const char *sensor_data_all = "sensor/data/all";
const char *sensor_info_packages = "sensor/info/packages";
const char *evaluation_mode = "sensor/change/eval_mode";

// Initialize DHT sensor
DHT dht(DHTPIN, DHTTYPE);

// Variables for JSON data switching
int prot_mode = 0;
const int capacity = JSON_OBJECT_SIZE(192); // capacity size
StaticJsonDocument<capacity> doc; // Json for data communication
StaticJsonDocument<capacity> docStats; // Json for data communication
char buffer_ff[sizeof(doc)]; // buffer for JSON message for CoAP and MQTT payload
char buffer_ip[sizeof(docStats)];

// Variables to hold sensor readings
float temp;
float hum;
long rssi;
Preferences preferences;
long int SAMPLE_FREQUENCY = INIT_SAMPLE_FREQ; // sample frequency of sampling
int MIN_GAS_VALUE = INIT_MIN_GAS; // minimum gas value corresponding to the upper value
int MAX_GAS_VALUE = INIT_MAX_GAS; // maximum gas value corresponding to the lower value
int AQI = INIT_AQI; // AQI value
int gas_values[5] = {NULL, NULL, NULL, NULL, NULL}; // status of gas values
float gas_avg = 0; //gas avg during AQI computation
int eval_mode = 0;
int count = 0;
// Threds mqtt and wifi
WiFiClient clientHTTP;
AsyncMqttClient mqttClient;
TimerHandle_t mqttReconnectTimer;
TimerHandle_t wifiReconnectTimer;
unsigned long previousMillis = 0;   // Stores last time temperature was published
const long interval = 10000;        // Interval at which to publish sensor readings

// setup wifi connection
void connectToWifi() {
  Serial.println("Connecting to Wi-Fi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// handling MQTT connection
void connectToMqtt() {
  Serial.println("Connecting to MQTT...");
  mqttClient.connect();
}

// handling wifi connection
void WiFiEvent(WiFiEvent_t event) {
  Serial.printf("[WiFi-event] event: %d\n", event);
  switch (event) {
    case SYSTEM_EVENT_STA_GOT_IP:
      Serial.println("WiFi connected");
      Serial.println("IP address: ");
      Serial.println(WiFi.localIP());
      connectToMqtt();
      break;
    case SYSTEM_EVENT_STA_DISCONNECTED:
      Serial.println("WiFi lost connection");
      xTimerStop(mqttReconnectTimer, 0); // ensure we don't reconnect to MQTT while reconnecting to Wi-Fi
      xTimerStart(wifiReconnectTimer, 0);
      break;
  }
}

// MQTT subscriptions
void onMqttConnect(bool sessionPresent) {
  Serial.println("Connected to MQTT.");
  Serial.print("Session present: ");
  Serial.println(sessionPresent);
  // ----------- Topic subscriptions -----------
  uint16_t packetIdSubAllData = mqttClient.subscribe(sensor_data_all, 1);
  uint16_t packetIdSubChangeVars = mqttClient.subscribe(sensor_change_vars, 1);
  uint16_t packetIdSubChangeProts = mqttClient.subscribe(sensor_change_prot, 1);
  uint16_t packetIdSubEvalMode = mqttClient.subscribe(evaluation_mode, 1);
  uint16_t packetIdSubInfoPackages = mqttClient.subscribe(sensor_info_packages, 1);
  /*Serial.print("Subscribing at QoS 1, packetId: ");
    Serial.println(packetIdSubAllData);
    Serial.print("Subscribing at QoS 1, packetId: ");
    Serial.println(packetIdSubChangeVars);
    Serial.print("Subscribing at QoS 1, packetId: ");
    Serial.println(packetIdSubChangeProts);
    Serial.print("Subscribing at QoS 1, packetId: ");
    Serial.println(packetIdSubWEvalMode);*/
}

void onMqttDisconnect(AsyncMqttClientDisconnectReason reason) {
  Serial.println("Disconnected from MQTT.");
  if (WiFi.isConnected()) {
    xTimerStart(mqttReconnectTimer, 0);
  }
}

void onMqttSubscribe(uint16_t packetId, uint8_t qos) {
  //serve per confermare l'avvenuta subscription al topic
  /*Serial.println("Subscribe acknowledged.");
    Serial.print("  packetId: ");
    Serial.println(packetId);
    Serial.print("  qos: ");
    Serial.println(qos);*/
}

void onMqttUnsubscribe(uint16_t packetId) {
  Serial.println("Unsubscribe acknowledged.");
  Serial.print("  packetId: ");
  Serial.println(packetId);
}

//MQTT callback
void onMqttMessage(char* topic, char* payload, AsyncMqttClientMessageProperties properties, size_t len, size_t index, size_t total) {

  Serial.print("Message arrived on topic: ");
  Serial.println(topic);
  char bufferfreq[len];

  for (int i = 0; i < len; i++) {
    bufferfreq[i] = (char) payload[i];
  }

  // handling the request for switching the protocol
  if (!strcmp(topic, sensor_change_prot)) {
    StaticJsonDocument<100> docSwitch;
    DeserializationError err = deserializeJson(docSwitch, bufferfreq);

    Serial.println("---------------");
    Serial.print("Change protocol to: ");
    // 0 == MQTT && 1 == HTTP
    int PROTOCOL = docSwitch["protocol"];

    if (prot_mode == 0 && PROTOCOL == 1) {
      prot_mode = 1;
      Serial.println("Http.");
    } else if (prot_mode == 1 && PROTOCOL == 0) {
      prot_mode = 0;
      Serial.println("Mqtt.");
    }
  }

  // handling the request for updating vars(frequency, min/max gas)
  if (!strcmp(topic, sensor_change_vars)) {
    StaticJsonDocument<200> varsJ;
    DeserializationError err = deserializeJson(varsJ, bufferfreq);
    Serial.println("Change variables to: ");
    long int sampleFrequency = varsJ["sampleFrequency"];
    int minGas = varsJ["minGas"];
    int maxGas = varsJ["maxGas"];

    if (sampleFrequency != -1 && sampleFrequency != 0) {
      Serial.print("Setup SAMPLE_FREQUENCY at: ");
      Serial.println(sampleFrequency);
      SAMPLE_FREQUENCY = sampleFrequency;
    }

    if (minGas != -1 && minGas != 0) {
      Serial.print("Setup MIN_GAS_VALUE at: ");
      Serial.println(minGas);
      MIN_GAS_VALUE = minGas;
    }

    if (maxGas != -1 && maxGas != 0) {
      Serial.print("Setup MAX_GAS_VALUE at: ");
      Serial.println(maxGas);
      MAX_GAS_VALUE = maxGas;
    }
  }

  // handling the request for switching the eval_mode
  if (!strcmp(topic, evaluation_mode)) {
    StaticJsonDocument<100> docEval;
    DeserializationError err = deserializeJson(docEval, bufferfreq);
    Serial.println("---------------");
    Serial.print("Change eval_mode to: ");
    // 0 == false && 1 == true
    eval_mode = docEval["mode"];
    if (eval_mode == 0) {
      Serial.println("False.");
      init_evaluation_vars();
    }
    else {
      Serial.println("True.");
    }
  }

  //handling the request for loss packets
  if (strcmp(topic, sensor_data_all) == 0 && eval_mode == 1) {
    STOP_EVALUATE_MQTT;
    if (eval_mode == 1 && count % 5 == 0) {
      print_stats();
      docStats["gps"]["lat"] = preferences.getString("lat");
      docStats["gps"]["lng"] = preferences.getString("long");
      docStats["rec_tot_packages_count"] = String(received_mqtt_packet_count) + "/" + String(total_mqtt_packet_count) + " mean time: " + mqtt_mean_time;
      serializeJson(docStats, buffer_ip);
      mqttClient.publish(sensor_info_packages, 1, true, buffer_ip);
    }
  }
}

void onMqttPublish(uint16_t packetId) {
  //Serve per confermare l'avvenuto invio del pacchetto seguito dal suo id
  /* Serial.println("Publish acknowledged.");
    Serial.print("  packetId: ");
    Serial.println(packetId);*/
}

void setup() {

  Serial.begin(115200);
  pinMode(MQ2PIN, INPUT);
  preferences.begin("iot-app", false);
  preferences.putString("lat", lat );
  preferences.putString("long", lon );
  dht.begin();

  mqttReconnectTimer = xTimerCreate("mqttTimer", pdMS_TO_TICKS(2000), pdFALSE, (void*)0, reinterpret_cast<TimerCallbackFunction_t>(connectToMqtt));
  wifiReconnectTimer = xTimerCreate("wifiTimer", pdMS_TO_TICKS(2000), pdFALSE, (void*)0, reinterpret_cast<TimerCallbackFunction_t>(connectToWifi));
  WiFi.onEvent(WiFiEvent);

  mqttClient.onConnect(onMqttConnect);
  mqttClient.onDisconnect(onMqttDisconnect);
  mqttClient.onSubscribe(onMqttSubscribe);
  mqttClient.onUnsubscribe(onMqttUnsubscribe);
  mqttClient.onMessage(onMqttMessage);
  mqttClient.onPublish(onMqttPublish);
  mqttClient.setServer(BROKER_MQTT, BROKER_PORT);
  // If your broker requires authentication (username and password), set them below
  //mqttClient.setCredentials("REPlACE_WITH_YOUR_USER", "REPLACE_WITH_YOUR_PASSWORD");
  connectToWifi();
  init_evaluation_vars();

}

void loop() {
  unsigned long currentMillis = millis();
  // Every X number of seconds (SAMPLE_FREQUENCY = 2.5 seconds)
  // it publishes a new MQTT message
  if (currentMillis - previousMillis >= SAMPLE_FREQUENCY) {
    // Save the last time a new reading was published
    previousMillis = currentMillis;
    // New sensors' readings
    hum = dht.readHumidity();
    temp = dht.readTemperature();
    //     Check if any reads failed and exit early (to try again).
    if (isnan(temp) || isnan(hum)) {
      Serial.println(F("Failed to read from DHT sensor!"));
      return;
    }

    int gas_current_value = analogRead(MQ2PIN);

    int i = 0;
    while (i < 5) {
      if (gas_values[i] == NULL) {
        gas_values[i] = gas_current_value;
        i = 5;
      } else {
        i += 1;
      }
    }

    // AQI computation
    if (gas_values[4] != NULL) {

      for (int c = 0; c < 5; c++) {
        gas_avg += gas_values[c];
      }

      gas_avg = gas_avg / 5;
      Serial.print("Gas avg: ");
      Serial.println(String(gas_avg).c_str());

      if (gas_avg >= MAX_GAS_VALUE) {
        AQI = 1;
      } else if ((gas_avg >= MIN_GAS_VALUE) && (gas_avg < MAX_GAS_VALUE)) {
        AQI = 0;
      } else {
        AQI = 2;
      }

      gas_avg = 0;
      for (int c = 0; c < 5; c++) {
        gas_values[c] = NULL;
      }
    }

    Serial.printf("Temp: %.2f \n", temp);
    Serial.printf("Hum: %.2f \n", hum);
    Serial.print("Gas: ");
    Serial.println(String(gas_current_value).c_str());
    // verify protocol mode and execute the sending
    if (prot_mode == 0) {

      Serial.println("Protocol: MQTT");
      // Publish an MQTT message on each sensor data topic
      doc["gps"]["lat"] = preferences.getString("lat");
      doc["gps"]["lng"] = preferences.getString("long");
      doc["rss"] = rssi;
      doc["temp"] = temp;
      doc["hum"] = hum;
      doc["gasv"]["gas"] = gas_current_value;

      if (AQI != -1) {
        doc["gasv"]["AQI"] = AQI;
        AQI = -1;
      }
      serializeJson(doc, buffer_ff);
      if (eval_mode == 1) {
        // Publish an MQTT message on topic sensor_data_all
        START_EVALUATE_MQTT(mqttClient.publish(sensor_data_all, 1, true, buffer_ff));
      } else {
        // Publish an MQTT message on topic sensor_data_all
        uint16_t packetIdPub1 = mqttClient.publish(sensor_data_all, 1, true, buffer_ff);
      }
    } else if (prot_mode == 1) {

      Serial.println("Protocol: HTTP");
      HTTPClient http;
      http.begin(clientHTTP, url_data);

      // Setting header content type: text/plain
      http.addHeader("Content-Type", "application/json");

      // Send sensor data in post requests
      doc["gps"]["lat"] = preferences.getString("lat");
      doc["gps"]["lng"] = preferences.getString("long");
      doc["rss"] = rssi;
      doc["temp"] = temp;
      doc["hum"] = hum;
      doc["gasv"]["gas"] = gas_current_value;

      if (AQI != -1) {
        doc["gasv"]["AQI"] = AQI;
        AQI = -1;

      }
      serializeJson(doc, buffer_ff);
      if (eval_mode == 1) {
        EVALUATE_HTTP(http.POST(buffer_ff));
      } else {
        http.POST(buffer_ff);
      }

      if (eval_mode == 1 && count % 5 == 0) {
        print_stats();
        http.begin(clientHTTP, url_packages_info);
        // Setting header content type: text/plain
        http.addHeader("Content-Type", "application/json");
        docStats["gps"]["lat"] = preferences.getString("lat");
        docStats["gps"]["lng"] = preferences.getString("long");
        docStats["rec_tot_packages_count"] = String(received_http_packet_count) + "/" + String(total_http_packet_count) + " mean time: " + http_mean_times;
        serializeJson(docStats, buffer_ip);
        int httpResponseCode = http.POST(buffer_ip);
        if (httpResponseCode > 0) {
          String response = http.getString();  //Get the response to the request
          Serial.println(httpResponseCode);   //Print return code
          Serial.println(response);           //Print request answer
        } else {
          Serial.print("Error on sending POST: ");
          Serial.println(httpResponseCode);

          http.end();

        }



        


      }
      http.end();
    }
    count++;
    Serial.println("--------------------------");
  }
}
