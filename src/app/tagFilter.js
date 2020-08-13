
const utils = require('./utils');

const tagName = utils.tagName;
const normalizeModelName = utils.normalizeModelName;

const applyTagFilter = (models, services, options) => {
  let i;
  // Normalize the included tag names
  const includeTags = options.includeTags;
  let included = null;
  if (includeTags && includeTags.length > 0) {
    included = [];
    for (i = 0; i < includeTags.length; i++) {
      included.push(tagName(includeTags[i], options));
    }
  }
  // Normalize the excluded tag names
  const excludeTags = options.excludeTags;
  let excluded = null;
  if (excludeTags && excludeTags.length > 0) {
    excluded = [];
    for (i = 0; i < excludeTags.length; i++) {
      excluded.push(tagName(excludeTags[i], options));
    }
  }
  // Filter out the unused models
  let ignoreUnusedModels = options.ignoreUnusedModels !== false;
  let usedModels = new Set();
  const addToUsed = (dep) => usedModels.add(dep);
  for (let serviceName in services) {
    let include =
      (!included || included.indexOf(serviceName) >= 0) &&
      (!excluded || excluded.indexOf(serviceName) < 0);
    if (!include) {
      // This service is skipped - remove it
      console.info(
        'Ignoring service ' + serviceName + ' because it was not included'
      );
      delete services[serviceName];
    } else if (ignoreUnusedModels) {
      // Collect the models used by this service
      let service = services[serviceName];
      service.serviceDependencies.forEach(addToUsed);
      service.serviceErrorDependencies.forEach(addToUsed);
    }
  }

  if (ignoreUnusedModels) {
    // Collect the model dependencies of models, so unused can be removed
    let allDependencies = new Set();
    usedModels.forEach(dep =>
      collectDependencies(allDependencies, dep, models)
    );

    // Remove all models that are unused
    for (let modelName in models) {
      let model = models[normalizeModelName(modelName)];
      // change thanh.vt
        continue;
      //
      if (!allDependencies.has(model.modelClass)) {
        // This model is not used - remove it
        console.info(
          'Ignoring model ' +
          modelName +
          ' because it was not used by any service'
        );
        delete models[normalizeModelName(modelName)];
      }
    }
  }
}

/**
 * Collects on the given dependencies set all dependencies of the given model
 */
function collectDependencies(dependencies, model, models) {
  if (!model || dependencies.has(model.modelClass)) {
    return;
  }
  dependencies.add(model.modelClass);
  if (model.modelDependencies) {
    model.modelDependencies.forEach((dep) =>
      collectDependencies(dependencies, dep, models)
    );
  }
}

module.exports = applyTagFilter;
