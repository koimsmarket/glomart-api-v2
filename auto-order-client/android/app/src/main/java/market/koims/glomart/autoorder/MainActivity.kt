package market.koims.glomart.autoorder
import android.app.*
import android.os.Bundle
import android.webkit.*
import org.json.JSONObject
class MainActivity: Activity(){
 private lateinit var web:WebView
 override fun onCreate(b:Bundle?){super.onCreate(b);web=WebView(this);setContentView(web);web.settings.javaScriptEnabled=true;web.settings.domStorageEnabled=true;web.settings.userAgentString=web.settings.userAgentString+" GlomartAutoOrderApp/0.001";web.addJavascriptInterface(Bridge(),"GMAO_ANDROID");web.webViewClient=object:WebViewClient(){override fun onPageFinished(v:WebView?,url:String?){web.evaluateJavascript("(function(){window.GMAO_CONFIG={assetBase:'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app/auto-order-client/shared/js'};var s=document.createElement('script');s.src=window.GMAO_CONFIG.assetBase+'/loader.js?v=001';document.documentElement.appendChild(s);})();",null)}};web.loadUrl("https://www.coupang.com/")}
 inner class Bridge{@JavascriptInterface fun deviceInfo()=JSONObject(mapOf("platform" to "android","model" to android.os.Build.MODEL)).toString();@JavascriptInterface fun notify(title:String,body:String){runOnUiThread{Toast.makeText(this@MainActivity,"$title\n$body",Toast.LENGTH_LONG).show()}};@JavascriptInterface fun close(){finish()}}
 override fun onBackPressed(){if(web.canGoBack())web.goBack() else super.onBackPressed()}
}
