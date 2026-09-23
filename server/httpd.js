!function() {
	var url = require('url');
	var fs = require('fs');
	var path = require('path');

	var mine = {
	  "css": "text/css",
	  "gif": "image/gif",
	  "html": "text/html",
	  "ico": "image/x-icon",
	  "jpeg": "image/jpeg",
	  "jpg": "image/jpeg",
	  "js": "text/javascript",
	  "json": "application/json",
	  "pdf": "application/pdf",
	  "png": "image/png",
	  "svg": "image/svg+xml",
	  "swf": "application/x-shockwave-flash",
	  "tiff": "image/tiff",
	  "txt": "text/plain",
	  "wav": "audio/x-wav",
	  "wma": "audio/x-ms-wma",
	  "wmv": "video/x-ms-wmv",
	  "xml": "text/xml"
	};

	function start(options){ // msgCallback,webPath,port,defWeb	
		if (options.pfx || options.key){
			var http = require("https");
			var server = http.createServer(options, callback);
		}else{
			var http = require("http");
			var server = http.createServer(callback);			
		}
		function callback(request, response) {
			var requrl = request.url; // index.html?msg=1
			var pathname = url.parse(requrl).pathname; // index.html
			var pathbase = options.webPath;
			if (requrl.indexOf("/jrt2.inc/") == 0){
				pathbase = process.env.NODE_PATH;
			}
			if (pathname.charAt(pathname.length - 1) === "/") {
				//如果访问目录
				pathname += options.defWeb; //指定为默认网页
			}
			var realPath = path.join(pathbase, pathname);
			console.log("[httpd]path=" + realPath);
			var ext = path.extname(realPath);
			ext = ext ? ext.slice(1) : 'unknown';
			fs.exists(realPath, function (exists) {
				if (!exists) {
					response.writeHead(404, {
						'Content-Type': 'text/plain'
					});

					response.write("This request URL " + pathname + " was not found on this server.");
					response.end();
				} else {
					fs.readFile(realPath, "binary", function (err, file) {
						if (err) {
							response.writeHead(500, {
								'Content-Type': 'text/plain'
							});
							response.end(err);
						} else {
							var contentType = mine[ext] || "text/plain";
							response.writeHead(200, {
								'Content-Type': contentType
							});
							response.write(file, "binary");
							response.end();
						}
					});
				}
			});
		};
		server.listen(options.port, options.host);
		console.log("[httpd]Server runing at port: " + options.port + ".");
		return server;
	}
	
	module.exports.start = start;
}();
