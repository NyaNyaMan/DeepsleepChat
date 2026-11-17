package com.deepseek.chat;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 应用唯一的界面容器：把打包进 assets 的网页界面装进 WebView。
 *
 * <p>页面通过 https://appassets.local/ 这个虚拟域名加载，请求全部由 {@link #serveAsset(Uri)}
 * 就地读取 assets，不经网络、也不需要本地起服务。使用 https origin 而非 file:// 的原因是
 * 聊天记录依赖 IndexedDB、API Key 依赖 localStorage，file:// 属于不透明来源，这些能力会被禁用。
 */
public class MainActivity extends Activity {

    private static final String TAG = "ChatDemo";
    private static final String APP_HOST = "appassets.local";
    private static final String START_URL = "https://" + APP_HOST + "/index.html";
    private static final String ASSET_ROOT = "www";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_MIC = 1002;
    /** 网页点击语音按钮时，先由原生申请系统权限（见 HostBridge#ensureMicPermission） */
    private static final int REQ_MIC_PREFLIGHT = 1003;

    private WebView webView;
    private View splashView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingAudioRequest;
    private boolean micPermissionPending;
    private boolean webViewPaused;
    private HostBridge bridge;
    private UpdateManager updateManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createViews();
        configureWebView();
        applyBarColors(getColor(R.color.window_background), isNightMode());

        if (savedInstanceState != null && webView.restoreState(savedInstanceState) != null) {
            hideSplash(150);
            ensureRestoredPageRendered();
        } else {
            webView.loadUrl(START_URL);
            // 兜底：网页脚本异常时也不要让启动图一直停留
            webView.postDelayed(() -> hideSplash(0), 8000);
        }
    }

    /** 进程被系统回收后恢复会话，缓存页面可能已失效，检测到空白就重新加载本地页面。 */
    private void ensureRestoredPageRendered() {
        webView.postDelayed(() -> {
            if (webView == null) {
                return;
            }
            webView.evaluateJavascript(
                    "(function(){var r=document.getElementById('root');"
                            + "return (r&&r.childElementCount>0)?'1':'0'})()",
                    value -> {
                        if (!"\"1\"".equals(value) && webView != null) {
                            webView.loadUrl(START_URL);
                        }
                    });
        }, 2000);
    }

    // ---------------------------------------------------------------- 视图

    private void createViews() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.window_background));

        webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.window_background));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        splashView = createSplashView();
        root.addView(splashView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
    }

    /** 启动图：与应用同色背景 + 品牌图标，网页首帧可见后淡出，避免白屏闪烁。 */
    private View createSplashView() {
        FrameLayout splash = new FrameLayout(this);
        splash.setBackgroundColor(getColor(R.color.window_background));
        splash.setClickable(true);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_launcher_foreground);
        logo.setImageTintList(ColorStateList.valueOf(getColor(R.color.brand_primary)));
        int size = Math.round(72 * getResources().getDisplayMetrics().density);
        splash.addView(logo, new FrameLayout.LayoutParams(size, size, Gravity.CENTER));
        return splash;
    }

    private void hideSplash(int delayMillis) {
        final View splash = splashView;
        if (splash == null) {
            return;
        }
        splash.postDelayed(() -> {
            if (splash.getVisibility() != View.VISIBLE) {
                return;
            }
            splash.animate().alpha(0f).setDuration(200).withEndAction(() -> {
                splash.setVisibility(View.GONE);
                if (splashView == splash) {
                    splashView = null;
                }
            }).start();
        }, delayMillis);
    }

    // ------------------------------------------------------------ WebView

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        // 聊天记录（IndexedDB）与设置（localStorage）依赖这两项
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // 只在虚拟域名下读取 assets，不允许页面直接读本地文件
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        // 朗读/提示音在用户点击后播放，不需要再要一次手势
        settings.setMediaPlaybackRequiresUserGesture(false);
        // 整页缩放会打乱固定视口布局，页面自身处理滚动
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setUseWideViewPort(false);
        settings.setLoadWithOverviewMode(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(
                settings.getUserAgentString() + " DeepsleepChat/" + BuildConfig.VERSION_NAME);

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setWebViewClient(new ChatWebViewClient());
        webView.setWebChromeClient(new ChatChromeClient());

        updateManager = new UpdateManager(this, webView);
        bridge = new HostBridge(this, webView, updateManager);
        webView.addJavascriptInterface(bridge, "AndroidHost");
    }

    private class ChatWebViewClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return serveAsset(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            return serveAsset(Uri.parse(url));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (APP_HOST.equalsIgnoreCase(uri.getHost())) {
                return false;
            }
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            hideSplash(180);
        }
    }

    private class ChatChromeClient extends WebChromeClient {

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;
            try {
                startActivityForResult(buildFileChooserIntent(params), REQ_FILE_CHOOSER);
            } catch (ActivityNotFoundException e) {
                filePathCallback = null;
                callback.onReceiveValue(null);
                return false;
            }
            return true;
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(() -> handlePermissionRequest(request));
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            Log.d(TAG, message.message() + " (" + message.lineNumber() + ")");
            return true;
        }
    }

    // --------------------------------------------------------- assets 服务

    private WebResourceResponse serveAsset(Uri uri) {
        if (uri == null || !APP_HOST.equalsIgnoreCase(uri.getHost())) {
            return null;
        }
        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "/index.html";
        }
        if (path.startsWith("/")) {
            path = path.substring(1);
        }
        if (path.contains("..")) {
            return notFound();
        }

        WebResourceResponse response = openAsset(path);
        if (response != null) {
            return response;
        }
        // 无扩展名的路径回退到 index.html（单页应用）
        if (!path.contains(".")) {
            response = openAsset("index.html");
            if (response != null) {
                return response;
            }
        }
        return notFound();
    }

    private WebResourceResponse openAsset(String path) {
        String mime = guessMimeType(path);
        try {
            InputStream stream = getAssets().open(ASSET_ROOT + "/" + path);
            Map<String, String> headers = new HashMap<>();
            // 产物文件名带内容哈希，可长期缓存；入口页不缓存，升级后立即生效
            headers.put("Cache-Control",
                    path.startsWith("static/") ? "public, max-age=31536000, immutable" : "no-cache");
            return new WebResourceResponse(mime, isTextual(mime) ? "utf-8" : null,
                    200, "OK", headers, stream);
        } catch (IOException e) {
            return null;
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<String, String>(),
                new ByteArrayInputStream("Not Found".getBytes(StandardCharsets.UTF_8)));
    }

    private static boolean isTextual(String mime) {
        return mime.startsWith("text/")
                || mime.contains("javascript")
                || mime.contains("json")
                || mime.contains("xml")
                || mime.contains("svg");
    }

    private static String guessMimeType(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        switch (ext) {
            case "html":
            case "htm":
                return "text/html";
            case "js":
            case "mjs":
                return "application/javascript";
            case "css":
                return "text/css";
            case "json":
            case "map":
                return "application/json";
            case "svg":
                return "image/svg+xml";
            case "png":
                return "image/png";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "gif":
                return "image/gif";
            case "webp":
                return "image/webp";
            case "ico":
                return "image/x-icon";
            case "woff":
                return "font/woff";
            case "woff2":
                return "font/woff2";
            case "ttf":
                return "font/ttf";
            case "otf":
                return "font/otf";
            case "wasm":
                return "application/wasm";
            case "txt":
            case "md":
                return "text/plain";
            default:
                return "application/octet-stream";
        }
    }

    // ------------------------------------------------------- 文件与权限

    private Intent buildFileChooserIntent(WebChromeClient.FileChooserParams params) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);

        Set<String> mimes = new LinkedHashSet<>();
        boolean unknownType = false;
        String[] acceptTypes = params.getAcceptTypes();
        if (acceptTypes != null) {
            for (String acceptType : acceptTypes) {
                if (acceptType == null || acceptType.trim().isEmpty()) {
                    continue;
                }
                for (String item : acceptType.split(",")) {
                    String value = item.trim().toLowerCase(Locale.ROOT);
                    if (value.isEmpty()) {
                        continue;
                    }
                    if ("*/*".equals(value)) {
                        unknownType = true;
                        continue;
                    }
                    String mime;
                    if (value.startsWith(".")) {
                        mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(value.substring(1));
                    } else {
                        mime = value.contains("/") ? value : null;
                    }
                    if (mime == null) {
                        // 有系统不认识的扩展名时放开为任意文件，交由页面按扩展名校验
                        unknownType = true;
                    } else {
                        mimes.add(mime);
                    }
                }
            }
        }

        if (unknownType || mimes.isEmpty()) {
            intent.setType("*/*");
        } else if (mimes.size() == 1) {
            intent.setType(mimes.iterator().next());
        } else {
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        }
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        return intent;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE_CHOOSER || filePathCallback == null) {
            return;
        }
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clipData = data.getClipData();
            if (clipData != null && clipData.getItemCount() > 0) {
                result = new Uri[clipData.getItemCount()];
                for (int i = 0; i < clipData.getItemCount(); i++) {
                    result[i] = clipData.getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        filePathCallback.onReceiveValue(result);
        filePathCallback = null;
    }

    /** 语音输入：网页申请麦克风时按需弹权限，拒绝后网页收到拒绝并给出提示。 */
    private void handlePermissionRequest(PermissionRequest request) {
        boolean wantsAudio = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                wantsAudio = true;
                break;
            }
        }
        if (!wantsAudio) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return;
        }
        if (pendingAudioRequest != null) {
            pendingAudioRequest.deny();
        }
        pendingAudioRequest = request;
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;

        if (requestCode == REQ_MIC_PREFLIGHT) {
            micPermissionPending = false;
            notifyMicResult(granted);
            return;
        }
        if (requestCode != REQ_MIC || pendingAudioRequest == null) {
            return;
        }
        if (granted) {
            pendingAudioRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pendingAudioRequest.deny();
        }
        pendingAudioRequest = null;
    }

    /**
     * 点击语音按钮时，网页先通过桥接调用这里拿到系统麦克风权限，再去 getUserMedia。
     *
     * <p>顺序很重要：如果先由 WebView 发起采集请求、再由原生弹系统权限框，
     * Activity 会先进入 paused（本类会把 WebView 一并暂停），挂起的采集请求可能被中断，
     * 网页侧只会收到一个笼统的失败。先把权限谈妥，后面的采集就不会再被打断。
     */
    void requestMicForWeb() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            notifyMicResult(true);
            return;
        }
        if (micPermissionPending) {
            // 正在等用户点系统弹窗，结果会在 onRequestPermissionsResult 里回传
            return;
        }
        micPermissionPending = true;
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC_PREFLIGHT);
    }

    private void notifyMicResult(boolean granted) {
        if (webView == null) {
            return;
        }
        webView.evaluateJavascript(
                "window.__hostMicResult&&window.__hostMicResult(" + granted + ")", null);
    }

    // ------------------------------------------------------------- 其它

    /** 系统返回键先交给页面：可收起抽屉、关闭弹层，页面不处理时再退出。 */
    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return (window.__hostBack&&window.__hostBack())?'1':'0'}"
                        + "catch(e){return '0'}})()",
                value -> {
                    if (!"\"1\"".equals(value)) {
                        finish();
                    }
                });
    }

    void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) {
            return;
        }
        String normalized = scheme.toLowerCase(Locale.ROOT);
        if (!"http".equals(normalized) && !"https".equals(normalized)
                && !"mailto".equals(normalized) && !"tel".equals(normalized)) {
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app_to_open, Toast.LENGTH_SHORT).show();
        }
    }

    /** 状态栏/导航栏跟随页面深浅色，由网页在主题变化时回调。 */
    void applyBarColors(int color, boolean dark) {
        Window window = getWindow();
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
        View decor = window.getDecorView();
        boolean lightIcons = !dark;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = decor.getWindowInsetsController();
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(lightIcons ? mask : 0, mask);
            }
        } else {
            int flags = decor.getSystemUiVisibility();
            if (lightIcons) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            } else {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            }
            if (lightIcons) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            } else {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
        }
    }

    private boolean isNightMode() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // 系统权限弹窗会让 Activity 进入 paused；此时不要连带暂停 WebView，
        // 否则正在等待授权的语音采集会被中断成"语音识别失败"。
        boolean waitingForPermission = micPermissionPending || pendingAudioRequest != null;
        if (webView != null && !waitingForPermission) {
            webView.onPause();
            webViewPaused = true;
        }
        if (bridge != null) {
            bridge.abortPendingSave();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null && webViewPaused) {
            webView.onResume();
            webViewPaused = false;
        }
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) {
            bridge.shutdown();
        }
        if (updateManager != null) {
            updateManager.release();
        }
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidHost");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
