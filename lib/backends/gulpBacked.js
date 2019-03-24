const constants = require("../constants");
const fs = require("fs");
const gulp = require("gulp");
const gclean = require("gulp-clean");
//const gfail = require('gulp-fail');
const gutil = require("gulp-util");
const grun = require("gulp-run");
const chalk = require("chalk");
const path = require("path");
const preprocess = require("gulp-preprocess");
const prettyTime = require("pretty-hrtime");
const PluginError = require("plugin-error");
const runSequence = require("run-sequence");
const merge2 = require("merge2");
const sourcemaps = require("gulp-sourcemaps");
const ts = require("gulp-typescript");
const tslint = require("gulp-tslint");

const gzip = require("gulp-gzip");
const tar = require("gulp-tar");
const install = require("gulp-install");

Object.defineProperty(Date.prototype, 'YYYYMMDDHHMMSS', {
	value: function () {
		function pad2(n) {  // always returns a string
			return (n < 10 ? '0' : '') + n;
		}

		return this.getFullYear() +
			pad2(this.getMonth() + 1) +
			pad2(this.getDate()) +
			pad2(this.getHours()) +
			pad2(this.getMinutes()) +
			pad2(this.getSeconds());
	}
});

// Format orchestrator errors
function formatError(e) {
	if (!e.err) {
		return e.message;
	}

	// PluginError
	if (typeof e.err.showStack === 'boolean') {
		return e.err.toString();
	}

	// Normal error
	if (e.err.stack) {
		return e.err.stack;
	}

	// Unknown (string, number, etc.)
	return new Error(String(e.err)).stack;
}

// Wire up logging events
function registerLogGulpEvents() {

	// Total hack due to poor error management in orchestrator
	gulp.on('err', function () {
		failed = true;
	});

	gulp.on('task_start', function (e) {
		// TODO: batch these
		// so when 5 tasks start at once it only logs one time with all 5
		gutil.log('Starting', '\'' + chalk.cyan(e.task) + '\'...');
	});

	gulp.on('task_stop', function (e) {
		var time = prettyTime(e.hrDuration);
		gutil.log(
			'Finished', '\'' + chalk.cyan(e.task) + '\'',
			'after', chalk.magenta(time)
		);
	});

	gulp.on('task_err', function (e) {
		var msg = formatError(e);
		var time = prettyTime(e.hrDuration);
		gutil.log(
			'\'' + chalk.cyan(e.task) + '\'',
			chalk.red('errored after'),
			chalk.magenta(time)
		);
		gutil.log(msg);
		process.exit(1);
	});

	gulp.on('task_not_found', function (err) {
		gutil.log(
			chalk.red('Task \'' + err.task + '\' is not in your gulpfile')
		);
		gutil.log('Please check the documentation for proper gulpfile formatting');
		process.exit(1);
	});
}

class GulpBackend {
	run(workDir, config, targets) {
		gutil.log("Using Gulp backend with targets:", targets);

		const self = this;

		const isCleanRequired = targets.indexOf(constants.TARGET_CLEAN) != -1 || targets.indexOf(constants.TARGET_PUBLISH) != -1 || targets.indexOf("default") != -1;

		const hasSrc = function() {
			if(config.type === "electron") {
				const src_main = path.join(workDir, config.paths.src_main);
				const src_render = path.join(workDir, config.paths.src_render);
				return fs.existsSync(src_main) || fs.existsSync(src_render);
			} else if(config.type === "webapp") {
				const src_client = path.join(workDir, config.paths.src_client);
				const src_server = path.join(workDir, config.paths.src_server);
				return fs.existsSync(src_client) || fs.existsSync(src_server);
			} else {
				return fs.existsSync(path.join(workDir, config.paths.src));
			}
		}();
		const hasTest = function() {
			return fs.existsSync(path.join(workDir, config.paths.test));
		}();
		const hasTypes = fs.existsSync(path.join(workDir, config.paths.types));
		const hasDist = fs.existsSync(path.join(workDir, config.paths.dist));

		function tsErrorFailure(error) {
			gutil.log(gutil.colors.red("Compilation failed"));
			process.exit(1);
		}

		/** The function create TS Project object.
		 * If a file tsconfig.json is not exist, the function will create it from a template.
		 */
		function safeCreateTsProject() {
			const tsConfigFile = path.join(workDir, "tsconfig.json");
			if (!fs.existsSync(tsConfigFile)) {
				gutil.log(chalk.red("The project has not a tsconfig.json file.") + " " + chalk.green("Creating tsconfig.json file... (you should commit it)"));
				const tsConfigTemplateFile = path.join(__dirname, "../../res/tsconfig.json");
				fs.copyFileSync(tsConfigTemplateFile, tsConfigFile, fs.constants.COPYFILE_EXCL);
			}
			return ts.createProject(tsConfigFile);
		}

		/** The function create options object for TS Lint.
		 * If a file tslint.json is not exist, the function will create it from a template.
		 */
		function safeCreateTslintOptions() {
			const tslintConfigFile = path.join(workDir, "tslint.json");
			if (!fs.existsSync(tslintConfigFile)) {
				gutil.log(chalk.red("The project has not a tslint.json file.") + " " + chalk.green("Creating tslint.json file... (you should commit it)"));
				const tslintConfigTemplateFile = path.join(__dirname, "../../res/tslint.json");
				fs.copyFileSync(tslintConfigTemplateFile, tslintConfigFile, fs.constants.COPYFILE_EXCL);
			}
			const tslintOptions = config.tslint ? Object.assign({}, config.tslint) : {};
			tslintOptions.configuration = tslintConfigFile;
			if (!tslintOptions.formatter) { tslintOptions.formatter = "verbose"; }
			return tslintOptions;
		}

		function safeCreateWebpackConfig() {
			const webpackConfigFile = path.join(workDir, "webpack.config.js");
			if (!fs.existsSync(webpackConfigFile)) {
				gutil.log(chalk.red("The project has not a webpack.config.js file.") + " " + chalk.green("Creating webpack.config.js file... (you should commit it)"));
				const webpackConfigTemplateFile = path.join(__dirname, `../../res/${config.type}-webpack.config.js`);
				fs.copyFileSync(webpackConfigTemplateFile, webpackConfigFile, fs.constants.COPYFILE_EXCL);
			}
			return require(webpackConfigFile);
		}

		const tslintReportOptions = {
		};

		// Clean
		{
			const cleanDeps = [];
			if (hasSrc) { cleanDeps.push(constants.TARGET_CLEAN + ":src"); }
			if (hasTest) { cleanDeps.push(constants.TARGET_CLEAN + ":test"); }
			cleanDeps.push(constants.TARGET_CLEAN + ":dist");
			gulp.task(constants.TARGET_CLEAN, function (cb) { 
				if(cleanDeps.length === 0) {
					return cb();
				}
				runSequence(cleanDeps, cb);
			});
			if (hasSrc) {
				gulp.task(constants.TARGET_CLEAN + ":src", function () {
					if(config.type === "electron") {
						return gulp.src(
							[
								config.paths.src_main + "/**/*.d.ts",
								config.paths.src_main + "/**/*.js",
								config.paths.src_main + "/**/*.map",
								config.paths.src_render + "/**/*.d.ts",
								config.paths.src_render + "/**/*.js",
								config.paths.src_render + "/**/*.map",
								"!" + config.paths.src_render + "/*-webpack.js"
							],
							{ read: false }
						)
							.pipe(gclean());
					} else if(config.type === "webapp") {
						return gulp.src(
							[
								config.paths.src_client + "/**/*.d.ts",
								config.paths.src_client + "/**/*.js",
								config.paths.src_client + "/**/*.map",
								"!" + config.paths.src_client + "/*-webpack.js",
								config.paths.src_server + "/**/*.d.ts",
								config.paths.src_server + "/**/*.js",
								config.paths.src_server + "/**/*.map"
							],
							{ read: false }
						)
							.pipe(gclean());
					} else {
						return gulp.src(
							[
								config.paths.src + "/**/*.d.ts",
								config.paths.src + "/**/*.js",
								config.paths.src + "/**/*.map"
							],
							{ read: false }
						)
							.pipe(gclean());
					}
				});
			}
			if (hasTest) {
				gulp.task(constants.TARGET_CLEAN + ":test", function () {
					return gulp.src(
						[
							config.paths.test + "/**/*.d.ts",
							config.paths.test + "/**/*.js",
							config.paths.test + "/**/*.map"
						],
						{ read: false }
					)
						.pipe(gclean());
				});
			}
//			if (hasDist) {
				gulp.task(constants.TARGET_CLEAN + ":dist", function (cb) {
					const paths = (config.type !== "electron" && config.type !== "webapp") ?
						[config.paths.dist, config.paths.package] :
						[config.paths.dist];
					return gulp.src(paths, { read: false }).pipe(gclean());
				});
//			}
		}

		// Compile
		{
			const compileDeps = [];
			const compileTaskDeps = [];
			if (hasSrc) {
				if(isCleanRequired) {
				    compileTaskDeps.push(constants.TARGET_CLEAN + ":src");
				}
				compileDeps.push(constants.TARGET_COMPILE + ":src");
				function generateLintTask(srcName, srcPath) {
					gulp.task(constants.TARGET_COMPILE + `:${srcName}:lint`, compileTaskDeps, function () {
						const tslintOptions = safeCreateTslintOptions();
						return gulp.src(
							[
								srcPath + "/**/*.ts",
								"!" + srcPath + "/**/*.d.ts"]
						)
							.pipe(tslint(tslintOptions))
							.pipe(tslint.report(tslintReportOptions));
					});
				}
				function generateTsTask(srcName, srcPath) {
					const compileTsDeps = compileTaskDeps.slice();
					compileTsDeps.push(constants.TARGET_COMPILE + `:${srcName}:lint`);
					gulp.task(constants.TARGET_COMPILE + `:${srcName}:ts`, compileTsDeps, function () {
						const preprocessContext = Object.assign({}, process.env);
						if(!("BUILD_TARGET" in preprocessContext)) {
							// Default BUILD_TARGET is "production"
							preprocessContext.BUILD_TARGET = "production";
						}
						const tsProject = safeCreateTsProject();
						let tsResult = gulp.src(
							[
								srcPath + "/**/*.ts",
								"!" + srcPath + "/**/*.d.ts"]
						)
							.pipe(preprocess({ context: preprocessContext }));
						if(process.env.BUILD_TARGET !== "production") {
							// include sourcemaps in NON production build
							tsResult = tsResult.pipe(sourcemaps.init()) // sourcemaps will be generated
						}
						tsResult = tsResult.pipe(tsProject())
							.on("error", tsErrorFailure);
						return merge2([
							tsResult.dts.pipe(gulp.dest(srcPath)),
							tsResult.js.pipe(sourcemaps.write(".", {
								includeContent: false,
								sourceRoot: "../" + srcPath,
								mapFile: function (p) { return p.replace(".js.map", ".map"); }
							}))
						])
							.pipe(gulp.dest(srcPath));
					});
				}
				function generateWebpackTasks(srcName, srcPath) {
					const apps = function() {
						const result = [];
						const fullSrcPath = path.join(workDir, srcPath);
						const subDirs = fs.readdirSync(fullSrcPath);
						subDirs.forEach(function(subDir) {
							if(subDir.startsWith("app.")) {
								const stat = fs.statSync(path.join(fullSrcPath, subDir));
								if(stat.isDirectory()) {
									result.push(subDir);
								}
							}
						});
						return result;
					}();
					const webpackTaskDeps = [];
					apps.forEach(function(app) {
						const taskName = constants.TARGET_COMPILE + `:${srcName}:${app}:webpack`;
						webpackTaskDeps.push(taskName);
						gulp.task(taskName, [constants.TARGET_COMPILE + `:${srcName}:ts`], function (cb) {
							try {
								const appDir = path.join(workDir, srcPath, app);
								const webpack = require(`${workDir}/node_modules/webpack`);
								const webpackMerge = require(`${workDir}/node_modules/webpack-merge`);
								//Loading WebPack config
								const webpackBaseConfig = function() {
									try { return safeCreateWebpackConfig(); } catch(e) {
										console.error(`Could not load webpack config file`, e);
										process.exit(1);
									}
								}();
								const webpackAppConfig = function() {
									try { return require(`${appDir}-webpack.js`); } catch(e) {
										console.error(`Could not load ${app}-webpack.js file for app '${app}'`, e);
										process.exit(1);
									}
								}();
								const webpackConfig = webpackMerge(webpackBaseConfig, webpackAppConfig);
								if (!("output" in webpackConfig)) { webpackConfig.output = {}; }
								if (!("filename" in webpackConfig.output)) { webpackConfig.output.filename = `${app}.js`; }
								if (!('path' in webpackConfig.output)) { webpackConfig.output.path = appDir; }
								if (!("entry" in webpackConfig)) { webpackConfig.entry = path.join(appDir, "index.js"); }
								if (!("optimization" in webpackConfig)) { webpackConfig.optimization = {}; }
								if (process.env.BUILD_TARGET === "production") {
									webpackConfig.mode = "production";
									webpackConfig.optimization.minimize = true;
								} else {
									webpackConfig.mode = "development";
									webpackConfig.optimization.minimize = false;
								}
								webpack(webpackConfig, function (err, stats) {
									if(stats && stats.compilation) {
										if(stats.compilation.warnings && stats.compilation.warnings instanceof Array) {
											stats.compilation.warnings.forEach(function(warning) {
												gutil.log(warning && warning.message ? warning.message : warning);
											});
										}
										if(stats.compilation.errors && stats.compilation.errors instanceof Array) {
											if(stats.compilation.errors.length > 0) {
												console.error(stats.compilation.errors);
												const e = stats.compilation.errors[0];
												cb(new PluginError("webpack", e && e.message ? e.message : e, { showStack: false }));
												process.exit(1); // I do not know how to fail task to prevent next
												return;
											}
										}
									}
									if (err) {
										console.error(err);
										cb(new gutil.PluginError("Cannot process webpack", err));
									} else {
										cb();
									}
								});
							} catch(e) {
								console.error(e);
								cb(new gutil.PluginError("Cannot process webpack", e));
							}
						});
					});
					gulp.task(constants.TARGET_COMPILE + `:${srcName}:webpack`, webpackTaskDeps);
				}
				if(config.type === "electron") {
					gulp.task(constants.TARGET_COMPILE + ":src", [
						constants.TARGET_COMPILE + ":src:main:lint",
						constants.TARGET_COMPILE + ":src:main:ts",
						constants.TARGET_COMPILE + ":src:render:lint",
						constants.TARGET_COMPILE + ":src:render:ts",
						constants.TARGET_COMPILE + ":src:render:webpack"
					]);
					gulp.task(constants.TARGET_COMPILE + ":src:ts", [
						constants.TARGET_COMPILE + ":src:main:ts",
						constants.TARGET_COMPILE + ":src:render:ts",
						constants.TARGET_COMPILE + ":src:render:webpack"
					]);
					gulp.task(constants.TARGET_COMPILE + ":src:lint", [
						constants.TARGET_COMPILE + ":src:main:lint",
						constants.TARGET_COMPILE + ":src:render:lint"
					]);
					generateLintTask("src:main", config.paths.src_main);
					generateLintTask("src:render", config.paths.src_render);
					generateTsTask("src:main", config.paths.src_main);
					generateTsTask("src:render", config.paths.src_render);
					generateWebpackTasks("src:render", config.paths.src_render);
				} else if(config.type === "webapp") {
					gulp.task(constants.TARGET_COMPILE + ":src", [
						constants.TARGET_COMPILE + ":src:client:lint",
						constants.TARGET_COMPILE + ":src:client:ts",
						constants.TARGET_COMPILE + ":src:client:webpack",
						constants.TARGET_COMPILE + ":src:server:lint",
						constants.TARGET_COMPILE + ":src:server:ts"
					]);
					gulp.task(constants.TARGET_COMPILE + ":src:ts", [
						constants.TARGET_COMPILE + ":src:client:ts",
						constants.TARGET_COMPILE + ":src:client:webpack",
						constants.TARGET_COMPILE + ":src:server:ts"
					]);
					gulp.task(constants.TARGET_COMPILE + ":src:lint", [
						constants.TARGET_COMPILE + ":src:client:lint",
						constants.TARGET_COMPILE + ":src:server:lint"
					]);
					generateLintTask("src:client", config.paths.src_client);
					generateLintTask("src:server", config.paths.src_server);
					generateTsTask("src:client", config.paths.src_client);
					generateTsTask("src:server", config.paths.src_server);
					generateWebpackTasks("src:client", config.paths.src_client);
				} else {
					gulp.task(constants.TARGET_COMPILE + ":src", [
						constants.TARGET_COMPILE + ":src:lint",
						constants.TARGET_COMPILE + ":src:ts"
					]);
					generateLintTask("src", config.paths.src);
					generateTsTask("src", config.paths.src);
				}
			}
			if (hasTest) {
				compileDeps.push(constants.TARGET_COMPILE + ":test");
				gulp.task(constants.TARGET_COMPILE + ":test", [
					constants.TARGET_COMPILE + ":test:lint",
					constants.TARGET_COMPILE + ":test:ts"
				]);
				gulp.task(constants.TARGET_COMPILE + ":test:lint", compileTaskDeps, function () {
					const tslintOptions = safeCreateTslintOptions();
					return gulp.src([config.paths.test + "/**/*.ts", "!" + config.paths.test + "/**/*.d.ts"])
						.pipe(tslint(tslintOptions)).pipe(tslint.report(tslintReportOptions));
				});
				gulp.task(
					constants.TARGET_COMPILE + ":test:ts",
					hasSrc ? [ constants.TARGET_COMPILE + ":src:ts"].concat(compileTaskDeps) : compileTaskDeps,
					function () {
						const tsProject = safeCreateTsProject();
						let tsResult = gulp.src([config.paths.test + "/**/*.ts", "!" + config.paths.test + "/**/*.d.ts"])
						if(process.env.BUILD_TARGET !== "production") {
							// include sourcemaps in NON production build
							tsResult = tsResult.pipe(sourcemaps.init()) // sourcemaps will be generated
						}
						tsResult = tsResult.pipe(tsProject())
							.on("error", tsErrorFailure);
						return merge2([
							tsResult.dts.pipe(gulp.dest(config.paths.test)),
							tsResult.js.pipe(sourcemaps.write(".", {
								includeContent: false,
								sourceRoot: "../" + config.paths.test,
								mapFile: function (p) { return p.replace(".js.map", ".map"); }
							}))
						])
							.pipe(gulp.dest(config.paths.test));
					}
				);
			}
			gulp.task(constants.TARGET_COMPILE, compileDeps);
		}

		if (hasTest) {
			gulp.task(constants.TARGET_TEST, [constants.TARGET_COMPILE + ":test"], function (cb) {
				if (!fs.existsSync(path.join(workDir, config.paths.test))) {
					// Nothing to test
					cb();
					return;
				}
				const spawnSync = require("child_process").spawnSync;
				let cbFired = false;
				const extendedPATH = process.env.PATH + path.delimiter + path.join(workDir, "node_modules/.bin");
				const spawnEnv = Object.assign({}, process.env);
				spawnEnv.PATH=extendedPATH;
				const spawnResult = spawnSync(
					"mocha",
					[
						"--no-timeouts",
						"--colors",
						"\"test/**/*.test.js\""
					],
					{ stdio: "pipe", cwd: workDir, shell: true, env: spawnEnv }
				);
				if (spawnResult.status === 0) {
					if (spawnResult.stdout) {
						console.log(spawnResult.stdout.toString());
					}
					cb();
				} else {
					let errMsg = "Unknown Mocha error: " + spawnResult.status;
					if(spawnResult.stdout || spawnResult.stderr) {
						errMsg = "";
						const nl = (process.platform === "win32" ? "\r\n" : "\n");
						if(spawnResult.stderr) {
							const stderr = spawnResult.stderr.toString();
							if(stderr) { errMsg += nl + stderr; }
						}
						if (spawnResult.stdout) {
							const stdout = spawnResult.stdout.toString();
							if(stdout) { errMsg += nl + stdout; }
						}
					}
					cb(new gutil.PluginError("zxbuild", errMsg));
				}
			});
		}

		// Dist
		{
			const distDeps = [];
			if (isCleanRequired || (targets.length === 1 && targets[0] === "default")) { distDeps.push(constants.TARGET_CLEAN); }
			if (hasSrc) { distDeps.push(constants.TARGET_COMPILE); }
			//if (hasTest) { distDeps.push(constants.TARGET_TEST); }
			gulp.task(constants.TARGET_DIST, distDeps, function (cb) {
				const packageJson = require(path.join(workDir, "package.json"));
				if ("devDependencies" in packageJson) { delete packageJson.devDependencies; }
				if ("private" in packageJson) { delete packageJson.private; }
				if ("scripts" in packageJson) { delete packageJson.scripts; }
				if ("types" in packageJson) { delete packageJson.types; }
				if ("typings" in packageJson) { delete packageJson.typings; }
				if (config.ZXConfig === true) {
					const zxnode = require("@zxnode/base");
					const configDir = config.ZXConfigDir ? config.ZXConfigDir : path.join(workDir, "config");
					gutil.log(chalk.green("Using ZXConfig directory: " + configDir));
					const appConfig = zxnode.fileConfiguration(configDir, process.env.SITE, true);
					const versionMajor = appConfig.getIntValue("version.major");
					const versionMinor = appConfig.getIntValue("version.minor");
			 		const versionBuild = appConfig.getIntValue("version.build");
					packageJson.version = versionMajor + "." + versionMinor + "." + versionBuild;
				} else {
					gutil.log(chalk.yellow("ZXConfig is not used in this project."));
				}

				if ("JENKINS_URL" in process.env) {
					// Looks like the build is executed in Jenkins CI environment
					if (!packageJson.build) { packageJson.build = {}; }
					packageJson.build.system = "jenkins";
					if (process.env.BUILD_ID) { packageJson.build.id = parseInt(process.env.BUILD_ID); }
					if (process.env.BUILD_URL) { packageJson.build.url = process.env.BUILD_URL; }
					if (process.env.SVN_URL) { 
						if (!packageJson.subversion) { packageJson.subversion = {}; }
						packageJson.subversion.url = process.env.SVN_URL;
					}
					if (process.env.SVN_REVISION) {
						if (!packageJson.subversion) { packageJson.subversion = {}; }
						packageJson.subversion.revision = parseInt(process.env.SVN_REVISION);
					}
				} else if (process.env.CI === "true" && process.env.CI_SERVER_NAME === "GitLab") {
					// Looks like the build is executed in GitLab CI environment
					if (!packageJson.build) { packageJson.build = {}; }
					packageJson.build.system = "gitlab";
					if (process.env.CI_PIPELINE_ID) {
						packageJson.build.id = parseInt(process.env.CI_PIPELINE_ID);
					}
					if (process.env.CI_PIPELINE_URL) {
						packageJson.build.url = process.env.CI_PIPELINE_URL;
					}
					if (process.env.CI_COMMIT_TAG) {
						packageJson.build.isTag = true;
						if (process.env.CI_COMMIT_TAG !== packageJson.version) {
							return cb(new Error(`Filed: Tag verision ${process.env.CI_COMMIT_TAG} != Package version ${packageJson.version}`));
						}
					} else if (process.env.CI_COMMIT_REF_SLUG) {
						packageJson.build.branch = process.env.CI_COMMIT_REF_SLUG;
					}
					if(process.env.CI_COMMIT_SHA) { packageJson.build.commit = process.env.CI_COMMIT_SHA; }
				} else {
					packageJson.version += "-dev" + new Date().YYYYMMDDHHMMSS();
					gutil.log(chalk.yellow(`The build is executed from non-CI environment. So update package version to: ${packageJson.version}`));
				}

				{ // Update any version of deps packages to concrete version
					if (packageJson.dependencies) {
						Object.keys(packageJson.dependencies).forEach(depPackage => {
							const depPackageVersion = packageJson.dependencies[depPackage];
							if (depPackageVersion == "" || depPackageVersion == "*") {
								const usedDepPackageVersion = "^" + require(path.join(workDir, "node_modules", depPackage, "package.json")).version;
								gutil.log(chalk.grey("Bind package version '" + depPackage + "' => " + usedDepPackageVersion));
								packageJson.dependencies[depPackage] = usedDepPackageVersion;
							}
						});
					}
				}

				if (hasSrc) {
					packageJson.main = "./lib/index.js";
					packageJson.types = "./lib/index.d.ts";
				} else if (hasTypes) {
					packageJson.types = "./types/index.d.ts";
				}

				// Ensure directory exists
				const fullDistDir = path.join(workDir, config.paths.dist);
				if (!fs.existsSync(fullDistDir)) { fs.mkdirSync(fullDistDir); }
				// You can replace following by just copy package.json, but I have already loaded it so let's just save
				fs.writeFileSync(path.join(fullDistDir, "package.json"), JSON.stringify(packageJson, null, "\t"));
				const arrayOfStreams = [
					gulp.src([
						path.join(workDir,"*.config*")
					]).pipe(gulp.dest(fullDistDir)),
					gulp.src([
						path.join(workDir, "res/**/*"),
					]).pipe(gulp.dest(path.join(fullDistDir, "res")))
				];
				const npmrcContent = fs.readFileSync(path.join(workDir, ".npmrc"), "utf-8");
				fs.writeFileSync(path.join(fullDistDir, ".npmrc"), npmrcContent.replace("package-lock=false", "package-lock=true"), "utf-8");
				if (hasSrc) {
					arrayOfStreams.push(gulp.src([path.join(workDir, config.paths.src + "/**/*.d.ts"), path.join(workDir, config.paths.src + "/**/*.js")])
						.pipe(gulp.dest(path.join(fullDistDir, "lib"))));
				}
				if (hasTypes) {
					arrayOfStreams.push(gulp.src(path.join(workDir, config.paths.types + "/**/*.d.ts"))
						.pipe(gulp.dest(path.join(fullDistDir, "types"))));
				}
				return merge2(arrayOfStreams);
			});
		}
		
		// Package
		{
			gulp.task(constants.TARGET_PACKAGE + ":install", [constants.TARGET_DIST], function() {
				const fullDistDir = path.join(workDir, config.paths.dist);
				return gulp.src(path.join(fullDistDir, "package.json")).pipe(install({ args: [ "--production", "--progress=false"] }));
			});
			gulp.task(constants.TARGET_PACKAGE + ":gz", [constants.TARGET_PACKAGE + ":install"], function(cb) {
				const fullDistDir = path.join(workDir, config.paths.dist);
				const packageJson = require(path.join(fullDistDir, "package.json"));
				const packageName = packageJson.name.replace("@", "").replace("/","-");
				const packageVersion = packageJson.version;
				const buildSystem = packageJson.build && packageJson.build.system;
				let versionString = packageVersion;
				if (buildSystem === "jenkins") {
					const revision = packageJson.subversion && packageJson.subversion.revision;
					if(revision) {
						versionString = `${versionString}-r${revision}`;
					}
					const build_id = packageJson.build.id;
					if(build_id) {
						versionString = `${versionString}-b${build_id}`;
					}
				} else if (buildSystem == "gitlab") {
					const isTag = packageJson.build.isTag;
					if (!isTag) {
						const build_id = packageJson.build.id;
						if (build_id) {
							versionString = `${versionString}-b${build_id}`;
						}
						const branch = packageJson.build.branch;
						if (branch) {
							versionString = `${versionString}-${branch}`
						}
						let commitSha = packageJson.build.commit;
						if (typeof commitSha === "string") {
							if (commitSha.length > 8) { commitSha = commitSha.substring(0, 8); }
							versionString = `${versionString}-${commitSha}`;
						}
					}
				}
				const apiMerged = merge2(
					gulp.src(path.join(fullDistDir, "**/*"))
						.pipe(tar(packageName + "-" + versionString + ".tar", { mode: null }))
						.pipe(gzip())
						.pipe(gulp.dest(config.paths.package)),
					gulp.src(path.join(workDir, "config", "project.properties", "**/*"))
						.pipe(tar(packageName + "-" + versionString + "-config.tar", { mode: null }))
						.pipe(gzip())
						.pipe(gulp.dest(config.paths.package))
				);
				return apiMerged;
			});
			gulp.task(constants.TARGET_PACKAGE, [constants.TARGET_PACKAGE + ":install", constants.TARGET_PACKAGE + ":gz"]);
		}

		// Publish
		{
			gulp.task(constants.TARGET_PUBLISH, [ constants.TARGET_DIST ], function (cb) {
				const fullDistDir = path.join(workDir, config.paths.dist);
				grun("npm publish", { "cwd": fullDistDir }).exec(cb);
			});
		}

		if(config.type === "electron") {
			gulp.task("default", [constants.TARGET_DIST]);
		} else if(config.type === "webapp") {
			gulp.task("default", [constants.TARGET_DIST]);
		} else {
			gulp.task("default", [constants.TARGET_DIST]);
		}

		return new Promise(function (resolve, reject) {
			const result = gulp.start.apply(gulp, targets);
			result.doneCallback = function () {
				resolve();
			}
		});
	}
}

registerLogGulpEvents();
const gulpBackend = new GulpBackend();
module.exports = { gulpBackend };
