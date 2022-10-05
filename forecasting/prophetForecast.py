import os
import pandas as pd
from pandas.tseries.offsets import DateOffset
import time
import logging
import datetime 
from influxdb_client import InfluxDBClient, Point, WriteOptions
from influxdb_client.client.write_api import SYNCHRONOUS
from influxdb_client.client.write_api import WriteType
import influxdb_client
from influxdb_client.client.write_api import SYNCHRONOUS
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
INFLUXDB_TOKEN = "tv86wL8ll2DgIg-vjmbiHD2RWnUNtKYUdEQRabhNZK6Czvwnl4UhJx6qx3dUUY5J-d76oLXnwCwOL7TzytR0UQ=="

SLEEP_TIME = 10
buckets = [ 'temperature', 'humidity', 'gas']

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

def calc_forecasting(bucket):
    query = 'from(bucket: "' + bucket + '")' \
        ' |> range(start: -1d)' \
        ' |> filter(fn: (r) => r["_measurement"] == "val")' \
        ' |> filter(fn: (r) => r["_field"] == "'+bucket+ '")' \

    result = client.query_api().query(org=INFLUXDB_ORG, query=query)
    print(result)
    # Convert the results to dataframe
    df = result_to_dataframe(result)
    # Convert the results to dataframe
    df['ds'] = df['ds'].dt.tz_localize(None)
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
    m.fit(df)
    # periods specifies the number of time series points you'd like to forecast onto 
    # freq time between points 
    future = m.make_future_dataframe(periods=60, freq= DateOffset(minutes=1))
    forecast = m.predict(future)
    # truncate ds to minutes
    forecast['ds'] = forecast.ds.dt.floor('min')
    lines = [str(forecast["yhat"][d]) for d in range(len(forecast))]
    print(lines)
    lines = ['val,prediction=yes,clientId=' + str("diubi-esp-32")+",lat=999,lng=999"+ " " + bucket + '=' + str(forecast["yhat"][d])
                                    + ' ' + str(int(time.mktime(forecast['ds'][d].timetuple())) + 3600*2) + "000000000" for d in range(len(forecast))]
    write_client = client.write_api(write_options=WriteOptions(batch_size=1000, flush_interval=10_000,
                                                            jitter_interval=2_000, retry_interval=5_000, write_type=WriteType.synchronous))
    write_client.write(bucket, INFLUXDB_ORG, lines)


if __name__ == '__main__':
    for bucket in buckets:
        calc_forecasting(bucket)

    time.sleep(SLEEP_TIME)