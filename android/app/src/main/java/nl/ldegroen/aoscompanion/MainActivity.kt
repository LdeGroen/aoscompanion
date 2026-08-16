package nl.ldegroen.aoscompanion

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    companion object {
        const val APP_URL = "https://aos.lucdegroen.nl/"
        const val VERSION_URL = "https://aos.lucdegroen.nl/version.json"
    }

    private lateinit var webView: WebView
    private lateinit var updateBar: LinearLayout
    private var updateUrl: String = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)

        // Android 15 (targetSdk 35) dwingt edge-to-edge af, waardoor de WebView
        // onder de status- en navigatiebalk schuift. We zetten de systeembalk-
        // insets als padding op een wrapper, zodat de app er net onder begint.
        val root = FrameLayout(this)
        root.setBackgroundColor(getColor(R.color.app_background))
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        // Update-balk bovenaan (verborgen tot er een nieuwere versie beschikbaar is).
        updateBar = buildUpdateBar()
        root.addView(
            updateBar,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
            )
        )

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
        // Zonder WebChromeClient toont een WebView geen JavaScript-dialogen:
        // confirm() doet dan stilletjes alsof je annuleert en alert() verdwijnt.
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView,
                request: android.webkit.WebResourceRequest,
                error: android.webkit.WebResourceError
            ) {
                if (!request.isForMainFrame) return
                view.loadDataWithBaseURL(null, errorHtml(), "text/html", "utf-8", null)
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

        checkForUpdate()
    }

    // Balk met "Nieuwe versie beschikbaar" + Updaten-knop; opent de APK-URL in de
    // browser zodat je de nieuwe APK kunt downloaden en installeren.
    private fun buildUpdateBar(): LinearLayout {
        val bar = LinearLayout(this)
        bar.orientation = LinearLayout.HORIZONTAL
        bar.gravity = Gravity.CENTER_VERTICAL
        bar.setBackgroundColor(Color.parseColor("#9c7913")) // goud (--gold)
        val pad = (12 * resources.displayMetrics.density).toInt()
        bar.setPadding(pad, pad, pad, pad)
        bar.visibility = View.GONE

        val text = TextView(this)
        text.text = "Nieuwe versie beschikbaar"
        text.setTextColor(Color.WHITE)
        text.textSize = 15f
        bar.addView(
            text,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )

        val updateBtn = Button(this)
        updateBtn.text = "Updaten"
        updateBtn.setOnClickListener {
            if (updateUrl.isNotEmpty()) {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(updateUrl)))
            }
        }
        bar.addView(updateBtn)

        val dismissBtn = Button(this)
        dismissBtn.text = "✕"
        dismissBtn.setOnClickListener { bar.visibility = View.GONE }
        bar.addView(dismissBtn)

        return bar
    }

    // Haalt version.json op en toont de update-balk als de gepubliceerde
    // versionCode hoger is dan die van deze geïnstalleerde app.
    private fun checkForUpdate() {
        Thread {
            try {
                val conn = URL(VERSION_URL).openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.requestMethod = "GET"
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val json = JSONObject(body)
                val latest = json.optInt("versionCode", 0)
                val url = json.optString("url", "")
                if (latest > BuildConfig.VERSION_CODE && url.isNotEmpty()) {
                    runOnUiThread {
                        updateUrl = url
                        updateBar.visibility = View.VISIBLE
                    }
                }
            } catch (e: Exception) {
                // Stil falen — geen internet of geen version.json is geen probleem.
            }
        }.start()
    }

    private fun errorHtml(): String = """
        <html><body style="background:#f4f5f7;color:#17181c;font-family:sans-serif;
        display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center"><h2 style="color:#9c7913">⚔️ Geen verbinding</h2>
        <p>De app kon niet laden. Controleer je internet en probeer opnieuw.</p>
        <a href="$APP_URL" style="color:#9c7913;font-size:1.2em">↻ Opnieuw proberen</a>
        </div></body></html>
    """.trimIndent()

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }
}
