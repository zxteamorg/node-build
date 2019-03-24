const path = require("path");
const VueLoaderPlugin = require("vue-loader/lib/plugin");

module.exports = {
	//devtool: "source-map",
	target: "web",
	mode: "This property will be set by zxbuild to 'development' or 'production' value. Do not set this manually.",
	entry: "This property will be set by zxbuild to correct value. Do not set this manually.",
	output: {
		filename: "bundle.js"
	},
	plugins: [
		new VueLoaderPlugin()
	],
	resolve: {
		alias: {
			"vue$": "vue/dist/vue.esm.js"
		},
		extensions: ["css", "html", "scss", "less", ".js", ".json", ".vue"],
		modules: [path.join(__dirname, 'node_modules')]
	},
	resolveLoader: {
		modules: [path.join(__dirname, 'node_modules')]
	},
	optimization: {
		minimize: "This property will be set by zxbuild to true or false value. Do not set this manually."
	}
};
