const swaggerAutogen = require('swagger-autogen')()

const outputFile = './swagger_output.json'
const endpointsFiles = ['./backend/app.js']

swaggerAutogen(outputFile, endpointsFiles)