# Snapdrop 

[Snapdrop](https://snapdrop.net): local file sharing in your browser. Inspired by Apple's Airdrop.


#### Snapdrop is built with the following awesome technologies:
* Vanilla HTML5 / ES6 / CSS3 frontend
* [WebRTC](http://webrtc.org/) / [WebSockets](http://www.websocket.org/)
* [NodeJS](https://nodejs.org/en/) backend
* [Progressive Web App](https://wikipedia.org/wiki/Progressive_Web_App)


Have any questions? Read our [FAQ](/docs/faq.md).

You can [host your own instance with Docker](/docs/local-dev.md).


## Support the Snapdrop Community
Snapdrop is free. Still, we have to pay for the server. If you want to contribute, please use PayPal:

[<img src="https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif">](https://www.paypal.com/donate/?hosted_button_id=MG8GV7YCYT352)

or Bitcoin:

[<img src="https://coins.github.io/thx/logo-color-large-pill-320px.png" alt="CoinThx" width="200"/>](https://coins.github.io/thx/#1K9zQ8f4iTyhKyHWmiDKt21cYX2QSDckWB?label=Snapdrop&message=Thanks!%20Your%20contribution%20helps%20to%20keep%20Snapdrop%20free%20for%20everybody!) 

[Bitcoin Lighting](https://tippin.me/@robin_linus)

Alternatively, you can become a [Github Sponsor](https://github.com/sponsors/RobinLinus).

Thanks a lot for supporting free and open software!

## 制作https服务器证书

参考 https://github.com/Subash/mkcert

- 安装mkcert；非全局安装 mkcert = node ./node_modules/mkcert/src/cli.js<br>
npm install -g mkcert 

- 制作ca证书<br>
mkcert create-ca --organization "LGN CA" --country-code "CN" --state "BeiJing" --locality "HaiDian" --validity 3652
    
- 制作服务器证书，请把localhost改成您服务器的域名<br>
create-cert --validity 365 --key "cerver.key" --cert "server.crt" --domains "localhost"

## 配置turn服务器

参考 https://github.com/coturn/coturn

修改 client/scripts/network.js文件最后 RTCPeer.config