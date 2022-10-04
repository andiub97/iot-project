import os
import pandas as pd
from pandas.tseries.offsets import DateOffset
import time
import logging
import datetime 
from influxdb_client import InfluxDBClient, Point, WriteOptions
from influxdb_client.client.write_api import WriteType
from fbprophet import Prophet
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
##from mongo_client import MongoClient

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

INFLUXDB_HOST = "localhost"
INFLUXDB_PORT = "8086"
INFLUXDB_ORG = "iot_group"
INFLUXDB_BUCKET = "temperature"
INFLUXDB_TOKEN = "W6ABceM-xNwEQveu4q-B05l3Wlg8NGJ0nBoRjs1PWVbhQhdF85Rx1Q0LMAkwfrNC7K8YRaJvQ4gchULmpAUoHg=="

SLEEP_TIME = 10
FIELDS = [ 'temp', 'gas', 'hum', 'soil']

##mongo_client = MongoClient()
client = InfluxDBClient(url="http://"+INFLUXDB_HOST+":"+INFLUXDB_PORT, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
def result_to_dataframe(result):
    raw = []
    for table in result:
        for record in table.records:
            raw.append((record.get_value(), record.get_time()))
    return pd.DataFrame(raw, columns=['y','ds'], index=None)

def loadData ():
    dataset_path = open("../datasets/temperature.csv")
    df = pd.read_csv(dataset_path)
    df.head()
    return df;  

def calc_forecasting(data):
    query = 'from(bucket: "' + INFLUXDB_BUCKET + '")' \
        ' |> range(start: -30d)' \
        ' |> filter(fn: (r) => r["_measurement"] == "val")' \
        ' |> filter(fn: (r) => r["_field"] == "temperature")' \

    result = client.query_api().query(org=INFLUXDB_ORG, query=query)
    print(result)
    # Convert the results to dataframe
    #df = result_to_dataframe(result)
    # Convert the results to dataframe
   # df['ds'] = df['ds'].dt.tz_localize(None)
    #data['ds'] = pd.to_datetime(data['ds']).dt.tz_localize(None)
    # Fit the model by instantiating a new Prophet object and passing in the historical DataFrame
    m = Prophet(
        yearly_seasonality=False,
        weekly_seasonality=False,
        daily_seasonality=20, # 20
        n_changepoints=50, # 30
        changepoint_range=0.8, # 0.8
        changepoint_prior_scale=0.5, # 0.5
        # interval_width=1.0
    )
    m.fit(data)
    # periods specifies the number of time series points you'd like to forecast onto 
    # freq time between points 
    future = m.make_future_dataframe(periods=60*24, freq= DateOffset(minutes=1))
    forecast = m.predict(future)
    # truncate ds to minutes
    forecast['ds'] = forecast.ds.dt.floor('min')
    lines = ["temperature" + '=' + str(forecast["yhat"][d]) + ' ' + str(int(time.mktime(forecast['ds'][d].timetuple()))) + "000000000" for d in range(len(forecast))]
    write_client = client.write_api(write_options=WriteOptions(batch_size=1000, flush_interval=10_000,
                                                            jitter_interval=2_000, retry_interval=5_000, write_type=WriteType.synchronous))
    write_client.write(INFLUXDB_BUCKET, INFLUXDB_ORG, lines)
    write_client.__del__()

def anal(data):
    interval = 30
    start_times =['2022-09-09T15:00']
    mse_array = []
    forecasted_array = []

    for start_time in start_times:
        stop_time = datetime.datetime.strptime(start_time, "%Y-%m-%dT%H:%M")
        stop_time = (stop_time + datetime.timedelta(minutes=interval)).strftime("%Y-%m-%dT%H:%M")

        print(start_time)
        print(stop_time)
        
        print("Check")
        #print(result)
        # Convert the results to dataframe
        data['ds'] = pd.to_datetime(data['ds']).dt.tz_localize(None)
        train, test = train_test_split(data, test_size=0.2, shuffle=False)
        m = Prophet(changepoint_prior_scale=0.01).fit(train)
        print(test.head())

        test_interval = int((test.iloc[-1]['ds'].timestamp() - test.iloc[0]['ds'].timestamp()) / 60)
        test_interval = test_interval + 5
        print(test_interval)

        future = m.make_future_dataframe(periods=test_interval, freq= DateOffset(minutes=1))
        forecast = m.predict(future)

        forecast['ds'] = forecast.ds.dt.floor('min')
        test['ds'] = test.ds.dt.floor('min')
        metric = test.set_index('ds')[['y']].join(forecast.set_index('ds').yhat).reset_index()
        mse = mean_squared_error(metric['y'], metric['yhat'])
        print("mse")
        print(mse)

        mse_array.append(mse) #trovare il modo di salvare tutti i dati
        forecasted_array.append(metric)
    print(mse_array)
    print(metric)



if __name__ == '__main__':
    data = loadData ()
    print(data)
    now = datetime.datetime.now()
    START_TIME = '-5y'
    START_TIME = (now - datetime.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    STOP_TIME = now.strftime("%Y-%m-%dT%H:%M:%S.%fZ") 
    calc_forecasting(data)
   # anal(data)
    time.sleep(SLEEP_TIME)