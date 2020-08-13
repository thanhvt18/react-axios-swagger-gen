const fs = require('fs');
const path = require('path');
const Mustache = require('mustache');
const $RefParser = require('json-schema-ref-parser');
let npmConfig = require('npm-conf');

/**
 * Converts a given type name into a TS file name
 */
const toFileName = (typeName) => {
  // let result = '';
  // let wasLower = false;
  // for (let i = 0; i < typeName.length; i++) {
  //   let c = typeName.charAt(i);
  //   let isLower = /[a-z]/.test(c);
  //   if (!isLower && wasLower) {
  //     result += '-';
  //   }
  //   result += c.toLowerCase();
  //   wasLower = isLower;
  // }
  return typeName.charAt(0).toLowerCase() + typeName.substr(1);
}


/**
 * Converts a given name into a valid class name
 */
const toClassName = (name) => {
  let result = '';
  let upNext = false;
  for (let i = 0; i < name.length; i++) {
    let c = name.charAt(i);
    let valid = /[\w]/.test(c);
    if (!valid) {
      upNext = true;
    } else if (upNext) {
      result += c.toUpperCase();
      upNext = false;
    } else if (result === '') {
      result = c.toUpperCase();
    } else {
      result += c;
    }
  }
  if (/[0-9]/.test(result.charAt(0))) {
    result = '_' + result;
  }
  return result;
}

/**
 * Returns a multi-line comment for the given text
 */
const toComments = (text, level) => {
  let indent = '';
  let i;
  for (i = 0; i < level; i++) {
    indent += '  ';
  }
  if (text == null || text.length === 0) {
    return indent;
  }
  const lines = text.trim().split('\n');
  let result = '\n' + indent + '/**\n';
  lines.forEach(line => {
    result += indent + ' *' + (line === '' ? '' : ' ' + line) + '\n';
  });
  result += indent + ' */\n' + indent;
  return result;
}

/**
 * Returns the TypeScript property type for the given raw property
 */
const propertyType = (property) => {
  let type;
  if (property === null || property.type === null) {
    return 'null';
  } else if (property.$ref != null) {
    // Type is a reference
    return simpleRef(property.$ref);
  } else if (property['x-type']) {
    // Type is read from the x-type vendor extension
    type = (property['x-type'] || '').toString().replace('List<', 'Array<');
    return type.length == 0 ? 'null' : type;
  } else if (property['x-nullable']) {
    return 'null | ' + propertyType(
      Object.assign(property, {'x-nullable': undefined}));
  } else if (!property.type && (property.anyOf || property.oneOf)) {
    let variants = (property.anyOf || property.oneOf).map(propertyType);
    return {
      allTypes: mergeTypes(...variants),
      toString: () => variants.join(' | ')
    };
  } else if (!property.type && property.allOf) {
    // Do not want to include x-nullable types as part of an allOf union.
    let variants = (property.allOf).filter(prop => !prop['x-nullable']).map(propertyType);

    return {
      allTypes: mergeTypes(...variants),
      toString: () => variants.join(' & ')
    };
  } else if (Array.isArray(property.type)) {
    let variants = property.type.map(type => propertyType(Object.assign({}, property, {type})));
    return {
      allTypes: mergeTypes(...variants),
      toString: () => variants.join(' | ')
    };
  }
  switch (property.type) {
    case 'null':
      return 'null';
    case 'string':
      if (property.enum && property.enum.length > 0) {
        return '\'' + property.enum.join('\' | \'') + '\'';
      }
      else if (property.const) {
        return '\'' + property.const + '\'';
      }
      else if (property.format === 'byte') {
        return 'ArrayBuffer';
      }
      return 'string';
    case 'array':
      if (Array.isArray(property.items)) { // support for tuples
        if (!property.maxItems) return 'Array<any>'; // there is unable to define unlimited tuple in TypeScript
        let minItems = property.minItems || 0,
          maxItems = property.maxItems,
          types = property.items.map(propertyType);
        types.push(property.additionalItems ? propertyType(property.additionalItems) : 'any');
        let variants = [];
        for (let i = minItems; i <= maxItems; i++) variants.push(types.slice(0, i));
        return {
          allTypes: mergeTypes(...types.slice(0, maxItems)),
          toString: () => variants.map(types => `[${types.join(', ')}]`).join(' | ')
        };
      }
      else {
        let itemType = propertyType(property.items);
        return {
          allTypes: mergeTypes(itemType),
          toString: () => 'Array<' + itemType + '>'
        };
      }
    case 'integer':
    case 'number':
      if (property.enum && property.enum.length > 0) return property.enum.join(' | ');
      if (property.const) return property.const;
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'file':
      return 'Blob';
    case 'object':
      let def = '{';
      let memberCount = 0;
      let allTypes = [];
      if (property.properties) {
        for (let name in property.properties) {
          let prop = property.properties[name];
          if (memberCount++) def += ', ';
          type = propertyType(prop);
          allTypes.push(type);
          let required = property.required && property.required.indexOf(name) >= 0;
          def += name + (required ? ': ' : '?: ') + type;
        }
      }
      if (property.additionalProperties) {
        if (memberCount++) def += ', ';
        type = typeof property.additionalProperties === 'object' ?
          propertyType(property.additionalProperties) : 'any';
        allTypes.push(type);
        def += '[key: string]: ' + type;
      }
      def += '}';

      return {
        allTypes: mergeTypes(...allTypes),
        toString: () => def,
      };
    default:
      return 'any';
  }
}

/**
 * Resolves the simple reference name from a qualified reference
 */
const simpleRef = (ref) => {
  if (!ref) {
    return null;
  }
  let index = ref.lastIndexOf('/');
  if (index >= 0) {
    ref = ref.substr(index + 1);
  }
  return toClassName(ref);
}

/**
 * Combine dependencies of multiple types.
 * @param types
 * @return {Array}
 */
function mergeTypes(...types) {
  let allTypes = [];
  types.forEach(type => {
    (type.allTypes || [type]).forEach(type => {
      if (allTypes.indexOf(type) < 0) allTypes.push(type);
    });
  });
  return allTypes;
}

let normalizeModelName = (name) => {
  return name.toLowerCase();
}

/**
 * Removes an array designation from the given type.
 * For example, "Array<a>" returns "a", "a[]" returns "a", while "b" returns "b".
 * A special case is for inline objects. In this case, the result is "object".
 */
let removeBrackets = (type, nullOrUndefinedOnly) => {
  if(typeof nullOrUndefinedOnly === "undefined") {
    nullOrUndefinedOnly = false;
  }
  if (typeof type === 'object') {
    if (type.allTypes && type.allTypes.length === 1) {
      return removeBrackets(type.allTypes[0], nullOrUndefinedOnly);
    }
    return 'object';
  }
  else if(type.replace(/ /g, '') !== type) {
    return removeBrackets(type.replace(/ /g, ''));
  }
  else if(type.indexOf('null|') === 0) {
    return removeBrackets(type.substr('null|'.length));
  }
  else if(type.indexOf('undefined|') === 0) {
    // Not used currently, but robust code is better code :)
    return removeBrackets(type.substr('undefined|'.length));
  }
  if (type == null || type.length === 0 || nullOrUndefinedOnly) {
    return type;
  }
  let pos = type.indexOf('Array<');
  if (pos >= 0) {
    let start = 'Array<'.length;
    return type.substr(start, type.length - start - 1);
  }
  pos = type.indexOf('[');
  return pos >= 0 ? type.substr(0, pos) : type;
}

/**
 * Normalizes the tag name. Actually, capitalizes the given name.
 * If the given tag is null, returns the default from options
 */
let tagName = (tag, options) => {
  if (tag == null || tag === '') {
    tag = options.defaultTag || 'Api';
  }
  tag = toIdentifier(tag);
  return tag.charAt(0).toUpperCase() + (tag.length == 1 ? '' : tag.substr(1));
}

/**
 * Transforms the given string into a valid identifier
 */
let toIdentifier = (string) => {
  let result = '';
  let wasSep = false;
  for (let i = 0; i < string.length; i++) {
    let c = string.charAt(i);
    if (/[a-zA-Z0-9]/.test(c)) {
      if (wasSep) {
        c = c.toUpperCase();
        wasSep = false;
      }
      result += c;
    } else {
      wasSep = true;
    }
  }
  return result;
}

/**
 * Creates all sub-directories for a nested path
 * Thanks to https://github.com/grj1046/node-mkdirs/blob/master/index.js
 */
const mkdirs = (folderPath, mode) => {
  let folders = [];
  let tmpPath = path.normalize(folderPath);
  let exists = fs.existsSync(tmpPath);
  while (!exists) {
    folders.push(tmpPath);
    tmpPath = path.join(tmpPath, '..');
    exists = fs.existsSync(tmpPath);
  }

  for (let i = folders.length - 1; i >= 0; i--) {
    fs.mkdirSync(folders[i], mode);
  }
}

/**
 * Removes the given file if it exists (logging the action)
 */
let rmIfExists = (file) => {
  if (fs.existsSync(file)) {
    console.info('Removing stale file ' + file);
    fs.unlinkSync(file);
  }
}

exports.toFileName = toFileName;
exports.toClassName = toClassName;
exports.toComments = toComments;
exports.propertyType = propertyType;
exports.simpleRef = simpleRef;
exports.mergeTypes = mergeTypes;
exports.normalizeModelName = normalizeModelName;
exports.removeBrackets = removeBrackets;
exports.tagName = tagName;
exports.toIdentifier = toIdentifier;
exports.rmIfExists = rmIfExists;
exports.mkdirs = mkdirs;
