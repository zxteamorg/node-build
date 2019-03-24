#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const { ZXBuild, DEFAULT_TARGET } = require("../lib");
const args = process.argv.splice(2);
// Temporary simple implementation without any checking of args
// just pass its as targets
const targets = (args && args.length > 0) ? args : [DEFAULT_TARGET];


const cwd = process.cwd();

let zxbuildConfig = undefined;
{
	const zxbuildConfigFile = path.join(cwd, "zxbuild.json");
	if (fs.existsSync(zxbuildConfigFile)) {
		console.log("Reading " + zxbuildConfigFile + "...");
		zxbuildConfig = require(zxbuildConfigFile);
	} else {
		console.log("A file \"" + zxbuildConfigFile + "\" was not found. Using default configuration.");
	}
}

const zxbuild = new ZXBuild(cwd, zxbuildConfig);
const result = zxbuild.run(targets);
if (result instanceof Promise) {
	result.then(
		function (asyncResult) { process.exit(asyncResult); },
		function (err) { process.exit(1); }
	)
} else {
	process.exit(result);
}
