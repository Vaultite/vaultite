// Safari runs this in the page being shared (NSExtensionJavaScriptPreprocessingFile): the page as the user sees it,
// logged in, for the clipper (ShareViewController.swift).
var Preprocess = function () {}
Preprocess.prototype = {
  run: function (args) {
    args.completionFunction({ url: document.URL, title: document.title, html: document.documentElement.outerHTML })
  },
  finalize: function () {},
}
var ExtensionPreprocessingJS = new Preprocess()
