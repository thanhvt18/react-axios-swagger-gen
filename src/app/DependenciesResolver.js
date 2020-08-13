
const utils = require('./utils')

const normalizeModelName  = utils.normalizeModelName;
const removeBrackets = utils.removeBrackets

/**
 * Class used to resolve the model dependencies
 */
function DependenciesResolver(models, ownType) {
  this.models = models;
  this.ownType = ownType;
  this.dependencies = [];
  this.dependencyNames = [];
}

/**
 * Adds a candidate dependency
 */
DependenciesResolver.prototype.add = function(input) {
  let deps;
  if (input.allTypes) {
    deps = input.allTypes;
  } else {
    deps = [removeBrackets(input)];
  }
  for (let i = 0; i < deps.length; i++) {
    let dep = deps[i];
    if (this.dependencyNames.indexOf(dep) < 0 && dep !== this.ownType) {
      let depModel = this.models[normalizeModelName(dep)];
      if (depModel) {
        this.dependencies.push(depModel);
        this.dependencyNames.push(depModel.modelClass);
      }
    }
  }
};

/**
 * Returns the resolved dependencies as a list of models
 */
DependenciesResolver.prototype.get = function() {
  return this.dependencies;
};

module.exports = DependenciesResolver;
