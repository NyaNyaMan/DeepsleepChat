package com.deepseek.chat;

import android.content.ContentValues;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 网页可调用的原生能力，注入为 window.AndroidHost。
 *
 * <p>浏览器的 download 属性、window.open、状态栏配色在 WebView 里没有等价实现，
 * 这里用最小接口补齐：
 * <ul>
 *   <li>beginSave / appendSave / finishSave：分块落盘，避免大文件（导出的聊天记录 ZIP）
 *       一次性转 base64 撑爆内存，最终写入系统「下载」目录</li>
 *   <li>openExternal：链接交给系统浏览器打开</li>
 *   <li>setChromeColor：主题切换时同步状态栏颜色与图标明暗</li>
 *   <li>httpRequestAsync：代网页发 HTTP 请求。第三方接口大多不允许跨域，
 *       WebView 里直接 fetch 会失败（Failed to fetch），走原生请求可以完全绕开 CORS</li>
 * </ul>
 * 所有方法都在 WebView 的 JavaBridge 线程执行，涉及界面操作时切回主线程。
 */
public class HostBridge {

    private static final String TAG = "ChatDemoBridge";
    private static final int MAX_NAME_LENGTH = 120;

    private final MainActivity activity;
    private final WebView webView;
    /** 原生 HTTP 请求用线程池，避免阻塞 JavaBridge 线程与页面 */
    private final ExecutorService httpExecutor = Executors.newCachedThreadPool();

    private File targetFile;
    private OutputStream targetStream;
    private String targetName;
    private String targetMime;

    HostBridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public boolean beginSave(String name, String mime) {
        abortPendingSave();
        try {
            File dir = new File(activity.getCacheDir(), "export");
            if (!dir.exists() && !dir.mkdirs()) {
                return false;
            }
            targetName = sanitizeName(name);
            targetMime = (mime == null || mime.isEmpty())
                    ? "application/octet-stream" : mime;
            targetFile = new File(dir, targetName);
            targetStream = new BufferedOutputStream(new FileOutputStream(targetFile));
            return true;
        } catch (IOException e) {
            Log.e(TAG, "beginSave failed", e);
            abortPendingSave();
            return false;
        }
    }

    @JavascriptInterface
    public boolean appendSave(String base64Chunk) {
        if (targetStream == null || base64Chunk == null) {
            return false;
        }
        try {
            targetStream.write(Base64.decode(base64Chunk, Base64.DEFAULT));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "appendSave failed", e);
            abortPendingSave();
            return false;
        }
    }

    @JavascriptInterface
    public String finishSave() {
        if (targetStream == null || targetFile == null) {
            return null;
        }
        String name = targetName != null ? targetName : "download";
        String mime = targetMime != null ? targetMime : "application/octet-stream";
        File file = targetFile;
        try {
            targetStream.flush();
            targetStream.close();
        } catch (IOException e) {
            Log.e(TAG, "flush failed", e);
            abortPendingSave();
            return null;
        }
        targetStream = null;
        targetName = null;
        targetMime = null;
        targetFile = null;

        String location = null;
        try {
            location = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? publishToDownloads(name, mime, file)
                    : publishToAppDownloads(name, file);
        } catch (Exception e) {
            Log.e(TAG, "publish failed", e);
        }
        if (file.exists() && !file.delete()) {
            Log.w(TAG, "temp file not deleted: " + file);
        }

        if (location != null) {
            toast(activity.getString(R.string.saved_to, location));
        } else {
            toast(activity.getString(R.string.save_failed));
        }
        return location;
    }

    @JavascriptInterface
    public void cancelSave() {
        abortPendingSave();
    }

    @JavascriptInterface
    public void openExternal(String url) {
        if (url == null || url.isEmpty()) {
            return;
        }
        final Uri uri = Uri.parse(url);
        activity.runOnUiThread(() -> activity.openExternal(uri));
    }

    /**
     * 网页在调用 getUserMedia 之前先调用本方法申请系统麦克风权限，
     * 结果异步回传给 window.__hostMicResult(granted)。
     */
    @JavascriptInterface
    public void ensureMicPermission() {
        activity.runOnUiThread(activity::requestMicForWeb);
    }

    @JavascriptInterface
    public void setChromeColor(String color, boolean dark) {
        final int parsed;
        try {
            parsed = Color.parseColor(color);
        } catch (IllegalArgumentException e) {
            return;
        }
        activity.runOnUiThread(() -> activity.applyBarColors(parsed, dark));
    }

    @JavascriptInterface
    public void toast(String message) {
        if (message == null || message.isEmpty()) {
            return;
        }
        activity.runOnUiThread(
                () -> Toast.makeText(activity, message, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    /**
     * 代网页发一次 HTTP 请求，结果通过 window.__hostHttpResult(id, json) 回传。
     *
     * <p>第三方接口（生图、模型列表等）通常不返回 CORS 头，WebView 里直接 fetch 会
     * 抛 "Failed to fetch"；走原生请求不受同源策略限制。异步执行，几十秒的生图请求
     * 也不会卡住页面。
     */
    @JavascriptInterface
    public void httpRequestAsync(String id, String method, String url, String headersJson, String body) {
        final String requestId = id == null || id.isEmpty() ? url : id;
        httpExecutor.execute(() -> {
            String result = executeHttp(method, url, headersJson, body);
            final WebView view = webView;
            if (view == null) {
                return;
            }
            String script = "window.__hostHttpResult&&window.__hostHttpResult("
                    + JSONObject.quote(requestId) + "," + JSONObject.quote(result) + ")";
            view.post(() -> view.evaluateJavascript(script, null));
        });
    }

    /**
     * 代网页发一次 multipart/form-data 请求（图片编辑类接口使用）。
     *
     * <p>partsJson 形如：
     * {"fields":{"model":"gpt-image-1","prompt":"..."},"files":[{"field":"image[]",
     * "name":"p1.png","mime":"image/png","base64":"..."}]}
     *
     * <p>为什么不在 JS 里用 FormData：容器内请求由原生代发（避开 CORS），而 JS 字符串
     * 经桥传到 Java 会被按 UTF-8 编码，二进制图片数据必然损坏，所以必须让原生按
     * base64 还原字节后再拼 multipart。
     */
    @JavascriptInterface
    public void httpMultipartAsync(String id, String url, String headersJson, String partsJson) {
        final String requestId = id == null || id.isEmpty() ? url : id;
        httpExecutor.execute(() -> {
            String result = executeMultipart(url, headersJson, partsJson);
            final WebView view = webView;
            if (view == null) {
                return;
            }
            String script = "window.__hostHttpResult&&window.__hostHttpResult("
                    + JSONObject.quote(requestId) + "," + JSONObject.quote(result) + ")";
            view.post(() -> view.evaluateJavascript(script, null));
        });
    }

    private String executeMultipart(String url, String headersJson, String partsJson) {
        try {
            JSONObject parts = new JSONObject(partsJson == null || partsJson.isEmpty() ? "{}" : partsJson);
            String boundary = "----DeepSleep" + Long.toHexString(System.nanoTime());
            ByteArrayOutputStream payload = new ByteArrayOutputStream();

            JSONObject fields = parts.optJSONObject("fields");
            if (fields != null) {
                for (Iterator<String> keys = fields.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    String value = fields.optString(key, "");
                    writeAscii(payload, "--" + boundary + "\r\n");
                    writeAscii(payload, "Content-Disposition: form-data; name=\"" + key + "\"\r\n\r\n");
                    writeAscii(payload, value + "\r\n");
                }
            }

            JSONArray files = parts.optJSONArray("files");
            if (files != null) {
                for (int i = 0; i < files.length(); i++) {
                    JSONObject file = files.optJSONObject(i);
                    if (file == null) {
                        continue;
                    }
                    String field = file.optString("field", "image");
                    String fileName = file.optString("name", "image.png");
                    String mime = file.optString("mime", "image/png");
                    byte[] data = Base64.decode(file.optString("base64", ""), Base64.DEFAULT);
                    writeAscii(payload, "--" + boundary + "\r\n");
                    writeAscii(payload, "Content-Disposition: form-data; name=\"" + field
                            + "\"; filename=\"" + fileName + "\"\r\n");
                    writeAscii(payload, "Content-Type: " + mime + "\r\n\r\n");
                    payload.write(data);
                    writeAscii(payload, "\r\n");
                }
            }

            writeAscii(payload, "--" + boundary + "--\r\n");
            return send(
                    "POST",
                    url,
                    headersJson,
                    payload.toByteArray(),
                    "multipart/form-data; boundary=" + boundary);
        } catch (Exception e) {
            Log.w(TAG, "multipart request failed: " + url, e);
            return failureResult(e);
        }
    }

    private static void writeAscii(ByteArrayOutputStream target, String text) throws IOException {
        target.write(text.getBytes(StandardCharsets.UTF_8));
    }

    private String executeHttp(String method, String url, String headersJson, String body) {
        try {
            byte[] payload = body == null || body.isEmpty() ? null : body.getBytes(StandardCharsets.UTF_8);
            String verb = method == null || method.isEmpty() ? "GET" : method.toUpperCase();
            return send(verb, url, headersJson, payload, "application/json; charset=utf-8");
        } catch (Exception e) {
            Log.w(TAG, "http request failed: " + url, e);
            return failureResult(e);
        }
    }

    /** 统一发送：负责请求头、超时、读响应体，返回 {"status":..,"body":..} 的 JSON 文本 */
    private String send(
            String method, String url, String headersJson, byte[] payload, String fallbackContentType) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(180_000);
            connection.setInstanceFollowRedirects(true);

            boolean hasContentType = false;
            if (headersJson != null && !headersJson.isEmpty()) {
                JSONObject headers = new JSONObject(headersJson);
                for (Iterator<String> keys = headers.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    String value = headers.optString(key, null);
                    if (key == null || value == null) {
                        continue;
                    }
                    if ("content-type".equalsIgnoreCase(key)) {
                        hasContentType = true;
                    }
                    connection.setRequestProperty(key, value);
                }
            }

            if (payload != null && payload.length > 0 && !"GET".equals(method)) {
                if (!hasContentType) {
                    connection.setRequestProperty("Content-Type", fallbackContentType);
                }
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(payload.length);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(payload);
                }
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 400
                    ? connection.getErrorStream() : connection.getInputStream();
            String text = stream == null ? "" : readText(stream);
            JSONObject result = new JSONObject();
            result.put("status", status);
            result.put("body", text);
            return result.toString();
        } catch (Exception e) {
            Log.w(TAG, "http send failed: " + url, e);
            return failureResult(e);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String failureResult(Exception e) {
        JSONObject result = new JSONObject();
        try {
            result.put("status", 0);
            result.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
        } catch (Exception ignored) {
            // JSONObject 放不进去时返回空对象，由前端按超时处理
        }
        return result.toString();
    }

    private static String readText(InputStream stream) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = stream.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toString("UTF-8");
    }

    /** 页面销毁时收尾，避免线程泄漏 */
    void shutdown() {
        httpExecutor.shutdownNow();
    }

    // ------------------------------------------------------------- 内部实现

    void abortPendingSave() {
        if (targetStream != null) {
            try {
                targetStream.close();
            } catch (IOException e) {
                Log.w(TAG, "close failed", e);
            }
            targetStream = null;
        }
        if (targetFile != null && targetFile.exists() && !targetFile.delete()) {
            Log.w(TAG, "temp file not deleted: " + targetFile);
        }
        targetFile = null;
        targetName = null;
        targetMime = null;
    }

    /** Android 10+ 写入公共「下载」目录，无需存储权限。 */
    private String publishToDownloads(String name, String mime, File source) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, mime);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri item = activity.getContentResolver()
                .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (item == null) {
            throw new IOException("MediaStore insert failed");
        }
        try (InputStream in = new FileInputStream(source);
             OutputStream out = activity.getContentResolver().openOutputStream(item)) {
            if (out == null) {
                throw new IOException("openOutputStream failed");
            }
            copy(in, out);
        } catch (IOException e) {
            activity.getContentResolver().delete(item, null, null);
            throw e;
        }

        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        activity.getContentResolver().update(item, values, null, null);
        return Environment.DIRECTORY_DOWNLOADS + "/" + name;
    }

    /** Android 8/9 没有 MediaStore.Downloads，写入应用专属下载目录，免存储权限。 */
    private String publishToAppDownloads(String name, File source) throws IOException {
        File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) {
            dir = new File(activity.getFilesDir(), "downloads");
        }
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("cannot create download dir");
        }
        File dest = new File(dir, name);
        try (InputStream in = new FileInputStream(source);
             OutputStream out = new FileOutputStream(dest)) {
            copy(in, out);
        }
        return dest.getAbsolutePath();
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
    }

    private static String sanitizeName(String name) {
        String value = (name == null || name.trim().isEmpty()) ? "download" : name.trim();
        value = value.replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "_");
        if (value.length() > MAX_NAME_LENGTH) {
            int dot = value.lastIndexOf('.');
            String extension = dot > 0 && value.length() - dot <= 10 ? value.substring(dot) : "";
            value = value.substring(0, MAX_NAME_LENGTH - extension.length()) + extension;
        }
        return value;
    }
}
