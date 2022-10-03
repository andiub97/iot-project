import os
import pandas as pd
from pandas.tseries.offsets import DateOffset
import time
import logging
import datetime 
from fbprophet import Prophet
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
##from mongo_client import MongoClient

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

INFLUXDB_HOST = os.getenv("INFLUX_HOST", "localhost")
INFLUXDB_PORT = os.getenv("INFLUXDB_PORT", "8086")
INFLUXDB_ORG = os.getenv("INFLUXDB_ORG", "lomo")
INFLUXDB_BUCKET = os.getenv("INFLUXDB_BUCKET", "lomo")
INFLUXDB_TOKEN = os.getenv("INFLUX_TOKEN", "adminadminadmin")

SLEEP_TIME = int(os.getenv("SLEEP_TIME", "10"))
FIELDS = [ 'temp', 'gas', 'hum', 'soil']

##mongo_client = MongoClient()
#client = InfluxDBClient(url="http://"+INFLUXDB_HOST+":"+INFLUXDB_PORT, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)

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
    # Convert the results to dataframe
    data['ds'] = pd.to_datetime(data['ds']).dt.tz_localize(None)
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
    lines = ["temperature" + '=' + str(forecast["yhat"][d])
                                    + ' ' + str(int(time.mktime(forecast['ds'][d].timetuple()))) + "000000000" for d in range(len(forecast))]
    print(lines)

if __name__ == '__main__':
    data = loadData ()
    print(data)
    now = datetime.datetime.now()
    START_TIME = '-5y'
    START_TIME = (now - datetime.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    STOP_TIME = now.strftime("%Y-%m-%dT%H:%M:%S.%fZ") 
    calc_forecasting(data)
    time.sleep(SLEEP_TIME)