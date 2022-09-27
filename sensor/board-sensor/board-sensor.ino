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

// HTTP Server
String serverName = "http://" + String(serverIP) + "/data";
// ----------- Topics -----------
const char *sensor_change_vars = "sensor/change/vars"; // setup topic to change metadata
const char *sensor_change_prot = "sensor/change/prot"; // richiesta di switching di protocollo
const char *sensor_data_all = "sensor/data/all";
const char *evaluation_mode = "sensor/change/eval_mode";

// Initialize DHT sensor
DHT dht(DHTPIN, DHTTYPE);

// Variables for JSON data switching
unsigned long previousTime = millis(); // timestamp
char prot_mode = '0';
const int capacity = JSON_OBJECT_SIZE(192); // capacity size
StaticJsonDocument<capacity> doc; // Json for data communication
char buffer_ff[sizeof(doc)]; // buffer for JSON message for CoAP and MQTT payload


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
unsigned long previousMillis = 0;   // Stores last time temperature was published
bool eval_mode = false;

WiFiClient clientMQTT;
WiFiClient clientHTTP;
PubSubClient MQTT(clientMQTT);

// -----------------MQTT functions--------------------------------------
void callbackMQTT(char *topic, byte *payload, unsigned int length) {

  Serial.print("Message arrived on topic: ");
  Serial.println(topic);
  char bufferfreq[length];

  for (int i = 0; i < length; i++) {
    bufferfreq[i] = (char) payload[i];
  }

  // handling the request for switching the protocol
  if (!strcmp(topic, sensor_change_prot)) {
    StaticJsonDocument<100> docSwitch;
    DeserializationError err = deserializeJson(docSwitch, bufferfreq);

    Serial.println("---------------");
    Serial.println("change protocol");
    // 0 == MQTT && 1 == HTTP
    int PROTOCOL = docSwitch["protocol"];
    Serial.println(PROTOCOL);
    if (prot_mode == '0' && PROTOCOL == 1) {
      prot_mode = 1;
      if (eval_mode == true) {
         STOP_EVALUATE_MQTT;
         print_stats();
      }

    } else if (prot_mode == '1' && PROTOCOL == 0) {
      prot_mode = 0;
    }
  }

  // handling the request for updating vars(frequency, min/max gas)
  if (!strcmp(topic, sensor_change_vars)) {
    StaticJsonDocument<200> varsJ;
    DeserializationError err = deserializeJson(varsJ, bufferfreq);
    Serial.println("update setup");
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
  // handling the request for switching the protocol
  if (!strcmp(topic, evaluation_mode)) {
    if (eval_mode == false) {
      eval_mode = true;
    } else {
      eval_mode = false;
    }
  }
}

// --------- MQTT setup ---------------------------
void MQTTSetup() {
  MQTT.setServer(BROKER_MQTT, BROKER_PORT);
  MQTT.setCallback(callbackMQTT); // setup the callback for the client connection (MQTT)
  while (!MQTT.connected()) {
    if (MQTT.connect("ESP32Client", mqtt_username, mqtt_password)) {
      Serial.println("Public emqx mqtt broker connected");
      MQTT.subscribe("sensor/change/prot"); // change prot
      MQTT.subscribe("sensor/change/vars"); // change vars
      MQTT.subscribe("sensor/change/eval_mode"); // change evaluation mode

    } else {
      // connection error handler
      Serial.print("failed with state ");
      Serial.print(MQTT.state());
      delay(2000);
    }
  }
}

void reconnectMQTT(void)
{
  while (!MQTT.connected()) {
    Serial.print("Attempting MQTT connection...");
    // Attempt to connect
    if (MQTT.connect("ESP32Client", mqtt_username, mqtt_password)) {
      Serial.println("connected");
      delay(5000);
      // Subscribe
      MQTT.subscribe(sensor_change_prot);
      MQTT.subscribe("sensor/change/vars");
      MQTT.subscribe("sensor/change/eval_mode");
    } else {
      Serial.print("failed, rc=");
      Serial.println(" try again in 5 seconds");
      // Wait 5 seconds before retrying
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(19200);
  pinMode(MQ2PIN, INPUT);
  preferences.begin("iot-app", false);
  preferences.putString("lat", lat );
  preferences.putString("long", lon );
  dht.begin();

  Serial.println("Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.mode(WIFI_STA);

  Serial.print("Connecting to WiFi..");
  Serial.println(WiFi.localIP());
  while (WiFi.status() != WL_CONNECTED) {
    delay(5000);
    Serial.print(".");
  }
  Serial.println("");
  Serial.println("WiFi connected");

  MQTTSetup();
  if(!eval_mode) {
    init_evaluation_vars();
  }

}

void loop() {

  if (!MQTT.connected()) {
    reconnectMQTT();
  }

  MQTT.loop();

  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    while (WiFi.status() != WL_CONNECTED) {
      delay(500);
      Serial.print(".");
    }
    Serial.println("WiFi reconnect");
  }

  // Wifi
  rssi = WiFi.RSSI();


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
  if (prot_mode == '0') {
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
    START_EVALUATE_MQTT(MQTT.publish(sensor_data_all, buffer_ff));

  } else if (prot_mode == '1') {
    Serial.println("Protocol: HTTP");
    HTTPClient http;
    http.begin(clientHTTP, serverName);

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
    if (eval_mode == true) {
      EVALUATE_HTTP(http.POST(buffer_ff));
      print_stats();
    } else {
      http.POST(buffer_ff);
    }

    http.end();
  }

  Serial.println("--------------------------");
  // customized delay based on the runtime setup
  delay(SAMPLE_FREQUENCY);

}
