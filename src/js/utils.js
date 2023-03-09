/* eslint-env node */

"use strict";

const JSON5 = require("json5"),
    fs = require("fs");

require("../../index.js");

const modules = {
    maxwell: global.__basedir
};

const stringTemplate = function (template, values) {
    let newString = template;
    for (const key in values) {
        const searchStr = "%" + key;
        newString = newString.replace(searchStr, values[key]);
    }
    return newString;
};

const resolvePath = function (path) {
    return stringTemplate(path, modules);
};

// Taken from https://codeburst.io/javascript-async-await-with-foreach-b6ba62bbf404
async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

const loadJSON5File = function (path) {
    const resolved = resolvePath(path);
    try {
        const text = fs.readFileSync(resolved, "utf8");
        return JSON5.parse(text);
    } catch (e) {
        e.message = "Error reading JSON5 file " + resolved + "\n" + e.message;
        throw e;
    }
};

module.exports = {modules, stringTemplate, resolvePath, asyncForEach, loadJSON5File};
