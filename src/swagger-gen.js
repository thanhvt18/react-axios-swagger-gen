const $RefParser = require('json-schema-ref-parser');

const doGenerate = require('./app/generator');

const ngSwaggerGen = (options) => {
  if (typeof options.swagger != 'string') {
    console.error("Swagger file not specified in the 'swagger' option");
    process.exit(1);
  }

  $RefParser.bundle(options.swagger,
    { dereference: { circular: false },
      resolve: { http: { timeout: options.timeout } } }).then(
    data => {
      doGenerate(data, options);
    },
    err => {
      console.error(
        `Error reading swagger location ${options.swagger}: ${err}`
      );
      process.exit(1);
    }
  ).catch(function (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  });
}

const option = {
  "swagger": "src/my-swagger.json",
  "baseUrl": "http://localhost:8082",
  "apiModule": false
}

ngSwaggerGen(option);
