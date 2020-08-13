const fs = require('fs');
const path = require('path');
const Mustache = require('mustache');
const $RefParser = require('json-schema-ref-parser');
let npmConfig = require('npm-conf');

const applyTagFilter = require('./tagFilter');
const processModels = require('./modelProcessor')
const processRepos = require('./serviceProcessor')
const utils = require('./utils');

const toFileName = utils.toFileName;
const toClassName = utils.toClassName;
const rmIfExists = utils.rmIfExists;
const mkdirs = utils.mkdirs;
const normalizeModelName = utils.normalizeModelName;

const doGenerate = (swagger, options) => {
  if (!options.templates) {
    options.templates = path.join(__dirname, 'templates');
  }

  let output = path.normalize(options.output || 'src/hooks');
  let prefix = options.prefix || 'Api';

  if (swagger.swagger !== '2.0') {
    console.error(
      'Invalid swagger specification. Must be a 2.0. Currently ' +
      swagger.swagger
    );
    process.exit(1);
  }
  swagger.paths = swagger.paths || {};
  swagger.models = swagger.models || [];
  let models = processModels(swagger, options);
  let repos = processRepos(swagger, models, options);

  // Apply the tag filter. If includeTags is null, uses all repos,
  // but still can remove unused models
  const includeTags = options.includeTags;
  if (typeof includeTags == 'string') {
    options.includeTags = includeTags.split(',');
  }
  const excludeTags = options.excludeTags;
  if (typeof excludeTags == 'string') {
    options.excludeTags = excludeTags.split(',');
  }
  applyTagFilter(models, repos, options);

  // Read the templates
  let templates = {};
  let files = fs.readdirSync(options.templates);
  files.forEach(function(file, index) {
    let pos = file.indexOf('.mustache');
    if (pos >= 0) {
      let fullFile = path.join(options.templates, file);
      templates[file.substr(0, pos)] = fs.readFileSync(fullFile, 'utf-8');
    }
  });

  // read the fallback templates
  let fallbackTemplates = path.join(__dirname, 'templates');
  fs.readdirSync(fallbackTemplates)
    .forEach(function (file) {
      let pos = file.indexOf('.mustache');
      if (pos >= 0) {
        let fullFile = path.join(fallbackTemplates, file);
        if (!(file.substr(0, pos) in templates)) {
          templates[file.substr(0, pos)] = fs.readFileSync(fullFile, 'utf-8');
        }
      }
    });

  // Prepare the output folder
  const modelsOutput = path.join(output, 'models');
  const reposOutput = path.join(output, 'repos');
  mkdirs(modelsOutput);
  mkdirs(reposOutput);

  let removeStaleFiles = options.removeStaleFiles !== false;
  let generateEnumModule = options.enumModule !== false;

  // Utility function to render a template and write it to a file
  let generate = function(template, model, file) {
    let code = Mustache.render(template, model, templates)
      .replace(/[^\S\r\n]+$/gm, '');
    fs.writeFileSync(file, code, 'UTF-8');
    console.info('Wrote ' + file);
  };

  // Calculate the globally used names
  let moduleClass = toClassName(prefix + 'Module');
  let moduleFile = toFileName(moduleClass);
  // Angular's best practices demands xxx.module.ts, not xxx-module.ts
  moduleFile = moduleFile.replace(/\-module$/, '.module');
  let configurationClass = toClassName(prefix + 'Configuration');
  let configurationInterface = toClassName(prefix + 'ConfigurationInterface');
  let configurationFile = toFileName(configurationClass);

  function applyGlobals(to) {
    to.prefix = prefix;
    to.moduleClass = moduleClass;
    to.moduleFile = moduleFile;
    to.configurationClass = configurationClass;
    to.configurationInterface = configurationInterface;
    to.configurationFile = configurationFile;
    return to;
  }

  // write axios client
  let pathAxiosWrite = path.join(output, 'axiosClient.ts');
  if (options['baseUrl']) {
    generate(templates.axios, { baseUrl: options['baseUrl'] }, pathAxiosWrite);
  } else {
    rmIfExists(pathAxiosWrite);
  }

  // Write the models
  let modelsArray = [];
  for (let modelName in models) {
    let model = models[normalizeModelName(modelName)];
    if (model.modelIsEnum) {
      model.enumModule = generateEnumModule;
    }
    applyGlobals(model);

    // When the model name differs from the class name, it will be duplicated
    // in the array. For example the-user would be TheUser, and would be twice.
    if (modelsArray.includes(model)) {
      continue;
    }
    modelsArray.push(model);
    generate(
      templates.model,
      model,
      path.join(modelsOutput, model.modelFile + '.ts')
    );
    if (options.generateExamples && model.modelExample) {
      let value = resolveRefRecursive(model.modelExample, swagger);
      let example = JSON.stringify(value, null, 2);
      example = example.replace(/'/g, "\\'");
      example = example.replace(/"/g, "'");
      example = example.replace(/\n/g, "\n  ");
      model.modelExampleStr = example;
      generate(
        templates.example,
        model,
        path.join(modelsOutput, model.modelExampleFile + '.ts')
      );
    }
  }
  if (modelsArray.length > 0) {
    modelsArray[modelsArray.length - 1].modelIsLast = true;
  }
  if (removeStaleFiles) {
    let modelFiles = fs.readdirSync(modelsOutput);
    modelFiles.forEach((file, index) => {
      let ok = false;
      let basename = path.basename(file);
      for (let modelName in models) {
        let model = models[normalizeModelName(modelName)];
        if (basename == model.modelFile + '.ts'
          || basename == model.modelExampleFile + '.ts'
          && model.modelExampleStr != null) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        rmIfExists(path.join(modelsOutput, file));
      }
    });
  }

  // Write the model index
  let modelIndexFile = path.join(modelsOutput, 'index.ts');
  if (options['modelIndex'] !== false) {
    generate(templates.models, { models: modelsArray }, modelIndexFile);
  } else if (removeStaleFiles) {
    rmIfExists(modelIndexFile);
  }

  // Write the repos
  let reposArray = [];
  for (let serviceName in repos) {
    let service = repos[serviceName];
    service.generalErrorHandler = options['errorHandler'] !== false;
    applyGlobals(service);
    reposArray.push(service);

    generate(
      templates.service,
      service,
      path.join(reposOutput, service['serviceFile'] + '.ts')
    );
  }
  if (reposArray.length > 0) {
    reposArray[reposArray.length - 1].serviceIsLast = true;
  }
  if (removeStaleFiles) {
    let serviceFiles = fs.readdirSync(reposOutput);
    serviceFiles.forEach((file, index) => {
      let ok = false;
      let basename = path.basename(file);
      for (let serviceName in repos) {
        let service = repos[serviceName];
        if (basename == service.serviceFile + '.ts') {
          ok = true;
          break;
        }
      }
      if (!ok) {
        rmIfExists(path.join(reposOutput, file));
      }
    });
  }

  // Write the repos index
  let repoIndexFile = path.join(reposOutput, 'index.ts');
  if (options['reposIndex'] !== false) {
    generate(templates.repos, { repos: reposArray }, repoIndexFile);
  } else if (removeStaleFiles) {
    rmIfExists(modelIndexFile);
  }
}

module.exports = doGenerate;
