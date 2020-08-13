
const utils = require('./utils');
const DependenciesResolver = require('./DependenciesResolver');

const toFileName = utils.toFileName;
const toClassName = utils.toClassName;
const toComments = utils.toComments;
const propertyType = utils.propertyType;
const simpleRef = utils.simpleRef;
const mergeTypes = utils.mergeTypes;
const normalizeModelName = utils.normalizeModelName;

const processModels = (swagger, options) => {
  let name, model, i, property;
  let models = {};
  for (name in swagger.definitions) {
    model = swagger.definitions[name];
    let parents = null;
    let properties = null;
    let requiredProperties = null;
    let additionalPropertiesType = false;
    let example = model.example || null;
    let enumValues = null;
    let elementType = null;
    let simpleType = null;
    if (model.allOf != null && model.allOf.length > 0) {
      parents = model.allOf
        .filter(parent => !!parent.$ref)
        .map(parent => simpleRef(parent.$ref));
      properties = (model.allOf.find(val => !!val.properties) || {}).properties || {};
      requiredProperties = (model.allOf.find(val => !!val.required) || {}).required || [];
      if (parents && parents.length) {
        simpleType = null;
        enumValues = null;
      }
    } else if (model.type === 'string') {
      enumValues = model.enum || [];
      if (enumValues.length == 0) {
        simpleType = 'string';
        enumValues = null;
      } else {
        for (i = 0; i < enumValues.length; i++) {
          let enumValue = enumValues[i];
          let enumDescriptor = {
            enumName: toEnumName(enumValue),
            enumValue: String(enumValue).replace(/\'/g, '\\\''),
            enumIsLast: i === enumValues.length - 1,
          };
          enumValues[i] = enumDescriptor;
        }
      }
    } else if (model.type === 'array') {
      elementType = propertyType(model);
    } else if (!model.type && (model.anyOf || model.oneOf)) {
      let of = model.anyOf || model.oneOf;
      let variants = of.map(propertyType);
      simpleType = {
        allTypes: mergeTypes(...variants),
        toString: () => variants.join(' |\n  ')
      };
    } else if (model.type === 'object' || model.type === undefined) {
      properties = model.properties || {};
      requiredProperties = model.required || [];
      additionalPropertiesType = model.additionalProperties &&
        (typeof model.additionalProperties === 'object' ? propertyType(model.additionalProperties) : 'any');
    } else {
      simpleType = propertyType(model);
    }
    let modelClass = toClassName(name);
    let descriptor = {
      modelName: name,
      modelClass: modelClass,
      modelFile: toFileName(modelClass),
      modelComments: toComments(model.description || ''),
      modelParents: parents,
      modelIsObject: properties != null,
      modelIsEnum: enumValues != null,
      modelIsArray: elementType != null,
      modelIsSimple: simpleType != null,
      modelSimpleType: simpleType,
      properties: properties == null ? null :
        processProperties(swagger, properties, requiredProperties),
      modelExample: example,
      modelAdditionalPropertiesType: additionalPropertiesType,
      modelExampleFile: toFileName(name),
      modelEnumValues: enumValues,
      modelElementType: elementType,
      modelSubclasses: [],
    };

    if (descriptor.properties != null) {
      descriptor.modelProperties = [];
      for (let propertyName in descriptor.properties) {
        property = descriptor.properties[propertyName];
        descriptor.modelProperties.push(property);
      }
      descriptor.modelProperties.sort((a, b) => {
        return a.propertyName < b.propertyName ? -1 :
          a.propertyName > b.propertyName ? 1 : 0;
      });
      if (descriptor.modelProperties.length > 0) {
        descriptor.modelProperties[
        descriptor.modelProperties.length - 1
          ].propertyIsLast = true;
      }
    }

    models[normalizeModelName(name)] = descriptor;
    models[normalizeModelName(descriptor.modelClass)] = descriptor;
  }

  // Now that we know all models, process the hierarchies
  for (name in models) {
    model = models[normalizeModelName(name)];
    if (!model.modelIsObject) {
      // Only objects can have hierarchies
      continue;
    }

    // Process the hierarchy
    let parents = model.modelParents;
    if (parents && parents.length > 0) {
      model.modelParents = parents
        .filter(parentName => !!parentName)
        .map(parentName => {
          // Make the parent be the actual model, not the name
          let parentModel =  models[normalizeModelName(parentName)];

          // Append this model on the parent's subclasses
          parentModel.modelSubclasses.push(model);
          return parentModel;
        });
      model.modelParentNames = model.modelParents.map(
        (parent, index) => ({
          modelClass: parent.modelClass,
          parentIsFirst: index === 0,
        })
      );
    }
  }

  // Now that the model hierarchy is ok, resolve the dependencies
  for (name in models) {
    model = models[normalizeModelName(name)];
    if (model.modelIsEnum || model.modelIsSimple && !model.modelSimpleType.allTypes) {
      // Enums or simple types have no dependencies
      continue;
    }
    let dependencies = new DependenciesResolver(models, model.modelName);

    let addToDependencies = t => {
      if (Array.isArray(t.allTypes)) {
        t.allTypes.forEach(it => dependencies.add(it));
      }
      else dependencies.add(t);
    };

    // The parent is a dependency
    if (model.modelParents) {
      model.modelParents.forEach(modelParent => {
        dependencies.add(modelParent.modelName);
      })
    }

    // Each property may add a dependency
    if (model.modelProperties) {
      for (i = 0; i < model.modelProperties.length; i++) {
        property = model.modelProperties[i];
        addToDependencies(property.propertyType);
      }
    }

    // If an array, the element type is a dependency
    if (model.modelElementType) addToDependencies(model.modelElementType);

    if (model.modelSimpleType) addToDependencies(model.modelSimpleType);

    if (model.modelAdditionalPropertiesType) addToDependencies(model.modelAdditionalPropertiesType);

    model.modelDependencies = dependencies.get();
  }

  return models;
}


/**
 * Process each property for the given properties object, returning an object
 * keyed by property name with simplified property types
 */
let processProperties = (swagger, properties, requiredProperties) => {
  let result = {};
  for (let name in properties) {
    let property = properties[name];
    let descriptor = {
      propertyName: name.indexOf('-') === -1 && name.indexOf(".") === -1 ? name : `"${name}"`,
      propertyComments: toComments(property.description, 1),
      propertyRequired: requiredProperties.indexOf(name) >= 0,
      propertyType: propertyType(property),
    };
    result[name] = descriptor;
  }
  return result;
}

module.exports = processModels;
