package org.starfleet.command;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * A WebView shell around the game.
 *
 * The app holds no INTERNET permission, so the WebView physically cannot
 * reach the network even if something in the page tried. The game is loaded
 * from a bundled asset over the file:///android_asset/ scheme, and every
 * navigation away from that scheme is refused below.
 */
public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Draw behind the system bars; the game handles its own safe-area insets.
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        getWindow().setStatusBarColor(0xFF000000);
        getWindow().setNavigationBarColor(0xFF000000);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);

        web = new WebView(this);
        WebSettings s = web.getSettings();

        s.setJavaScriptEnabled(true);
        // localStorage is where the command record lives.
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);

        // Nothing is fetched, so caching policy is academic; be explicit anyway.
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setBlockNetworkLoads(true);
        s.setBlockNetworkImage(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        // The page is designed for the device width; do not let the WebView
        // apply desktop-viewport heuristics on top of the game's own layout.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);

        // Web Audio must be allowed to start from the game's own tap handler.
        s.setMediaPlaybackRequiresUserGesture(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }

        web.setBackgroundColor(0xFF000000);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Refuse to navigate anywhere except the bundled asset.
                String url = request.getUrl().toString();
                return !url.startsWith("file:///android_asset/");
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if (scheme != null && (scheme.equals("http") || scheme.equals("https"))) {
                    // Belt and braces: the app has no INTERNET permission, but
                    // an outbound request should fail loudly rather than hang.
                    return new WebResourceResponse("text/plain", "utf-8", null);
                }
                return null;
            }
        });

        setContentView(web);
        web.loadUrl("file:///android_asset/game.html");
    }

    /** Back steps through the game's own screens before it leaves the app. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript(
                "(function(){var a=window.__app;"
                        + "if(a&&a.modalHandle){a.closeModal();return 'handled';}"
                        + "if(a&&a.screen&&a.screen!=='bridge'){a.go('bridge');return 'handled';}"
                        + "return 'exit';})()",
                value -> {
                    if (value == null || value.contains("exit")) {
                        finish();
                    }
                });
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Let the game autosave and stop its audio graph.
        web.evaluateJavascript("window.__app && window.__app.save && window.__app.save();", null);
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
