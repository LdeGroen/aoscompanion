package nl.ldegroen.aoscompanion

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {

    companion object {
        const val APP_URL = "https://ldegroen.github.io/aoscompanion/"
    }

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)

        // Android 15 (targetSdk 35) dwingt edge-to-edge af, waardoor de WebView
        // onder de status- en navigatiebalk schuift. We zetten de systeembalk-
        // insets als padding op een wrapper, zodat de app er net onder begint.
        val root = FrameLayout(this)
        root.setBackgroundColor(getColor(R.color.app_background))
        root.addView(webView)
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        webView.setBackgroundColor(getColor(R.color.app_background))
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true // nodig voor localStorage (alle app-data)
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView,
                request: android.webkit.WebResourceRequest,
                error: android.webkit.WebResourceError
            ) {
                if (!request.isForMainFrame) return
                view.loadDataWithBaseURL(
                    null,
                    """<html><body style="background:#15161c;color:#e8e6df;font-family:sans-serif;
                       display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                       <div style="text-align:center"><h2 style="color:#c9a227">⚔️ Geen verbinding</h2>
                       <p>De app kon niet laden. Controleer je internet en probeer opnieuw.</p>
                       <a href="$APP_URL" style="color:#c9a227;font-size:1.2em">↻ Opnieuw proberen</a>
                       </div></body></html>""",
                    "text/html", "utf-8", null
                )
            }
        }

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }
}
