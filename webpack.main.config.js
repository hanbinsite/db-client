const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: {
    main: './src/main/main.ts',
    preload: './src/main/preload.ts'
  },
  target: 'electron-main',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  plugins: [
    // 忽略pg-native模块，这是一个可选依赖
    new webpack.IgnorePlugin({
      resourceRegExp: /pg-native/
    })
  ],
  node: {
    __dirname: false,
    __filename: false
  }
};