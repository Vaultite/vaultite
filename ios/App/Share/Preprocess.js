// Safari runs this in the page being shared (NSExtensionJavaScriptPreprocessingFile): the page as the user sees it,
// logged in, for the clipper (ShareViewController.swift).
var Preprocess = function () {}
Preprocess.prototype = {
  run: function (args) {
    args.completionFunction({ url: document.URL, title: document.title, html: document.documentElement.outerHTML })
  },
  finalize: function () {},
}
// eslint-disable-next-line no-unused-vars -- Safari reads this global by name
var ExtensionPreprocessingJS = new Preprocess()
