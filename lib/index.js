"use strict";

const { gulpBackend } = require("./backends/gulpBacked");

const DEFAULT_TARGET = "default";

function deepObjectExtend(target, source) {
	for (var prop in source) {
		if (source.hasOwnProperty(prop)) {
			if (target[prop] && typeof source[prop] === 'object') {
				deepObjectExtend(target[prop], source[prop]);
			}
			else {
				target[prop] = source[prop];
			}
		}
	}
	return target;
}

class ZXBuild {
	constructor(workDir, config) {
		this._workDir = workDir;
		const defaultConfig = function() {
			if(config && config.type === "electron") {
				return {
					type: "electron",
					paths: {
						dist: ".dist",
						src_main: "src.main",
						src_render: "src.render",
						test: "test",
						types: "types"
					}
				};
			} else if(config && config.type === "webapp") {
				return {
					type: "electron",
					paths: {
						dist: ".dist",
						src_client: "src.client",
						src_server: "src.server",
						test: "test",
						types: "types"
					}
				};
			} else {
				return {
					type: "default" /* electron, webapp */,
					paths: {
						dist: ".dist",
						package: ".package",
						src: "src",
						test: "test",
						types: "types"
					}
				};
			}
		}();

		const mergeConfig = Object.assign({}, defaultConfig);
		if (config) {
			deepObjectExtend(mergeConfig, config);
		}
		this._config = mergeConfig;
	}

	run(targets) {
		{ // check arguments
			const errorMessage = "Wrong 'targets' argument. Expect an array of strings.";
			if (!Array.isArray(targets)) { throw ReferenceError(errorMessage); }
		}
		return gulpBackend.run(this._workDir, this._config, targets);
	}
}

module.exports = {
	ZXBuild,
	DEFAULT_TARGET
}
