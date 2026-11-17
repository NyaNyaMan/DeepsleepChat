package com.deepseek.chat;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.util.Arrays;

/**
 * 应用内更新：下载 GitHub Release 里的 APK，校验通过后交给系统安装器。
 *
 * <p>安卓不允许普通应用静默安装，所以这里只做到「自动下载 + 一次确认」：
 * 下载交给 {@link DownloadManager}（不需要存储权限，带进度通知），
 * 完成后校验包名、版本号与签名证书，再由用户点「安装」调起系统安装器。
 */
final class UpdateManager {

    private static final String APK_NAME = "chat-update.apk";

    private final MainActivity activity;
    private final WebView webView;

    private long downloadId = -1;
    private boolean receiverRegistered;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id != downloadId) {
                return;
            }
            finishDownload(id);
        }
    };

    UpdateManager(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    /** 开始下载；重复调用会先清掉上一次的文件 */
    void download(String url) {
        if (url == null || !url.startsWith("https://")) {
            emit("error", "更新地址无效");
            return;
        }
        Uri uri;
        try {
            uri = Uri.parse(url);
        } catch (Exception e) {
            emit("error", "更新地址无效");
            return;
        }
        File target = apkFile();
        if (target.exists() && !target.delete()) {
            emit("error", "无法清理旧的安装包");
            return;
        }
        DownloadManager.Request request = new DownloadManager.Request(uri)
                .setTitle("DeepsleepChat 更新")
                .setDescription("正在下载新版本")
                .setMimeType("application/vnd.android.package-archive")
                .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, APK_NAME)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
        DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            emit("error", "系统下载服务不可用");
            return;
        }
        try {
            downloadId = manager.enqueue(request);
        } catch (Exception e) {
            emit("error", "下载失败：" + e.getMessage());
            return;
        }
        registerReceiver();
        emit("downloading", "");
    }

    private void registerReceiver() {
        if (receiverRegistered) {
            return;
        }
        activity.registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        receiverRegistered = true;
    }

    /** Activity 销毁时解除监听 */
    void release() {
        if (!receiverRegistered) {
            return;
        }
        try {
            activity.unregisterReceiver(receiver);
        } catch (Exception ignored) {
            // 已经解绑过就忽略
        }
        receiverRegistered = false;
    }

    private void finishDownload(long id) {
        DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            emit("error", "系统下载服务不可用");
            return;
        }
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
        try (android.database.Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                emit("error", "下载结果丢失");
                return;
            }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                emit("error", "下载失败（" + reason + "）");
                return;
            }
        }
        String error = verify(apkFile());
        if (error != null) {
            apkFile().delete();
            emit("error", error);
            return;
        }
        emit("ready", "");
    }

    /** 调起系统安装器，返回状态给网页决定提示文案 */
    String install() {
        File apk = apkFile();
        if (!apk.isFile()) {
            return "missing";
        }
        String error = verify(apk);
        if (error != null) {
            return "invalid:" + error;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !activity.getPackageManager().canRequestPackageInstalls()) {
            openUnknownSourcesSettings();
            return "permission";
        }
        long id = downloadId;
        DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        Uri uri = manager == null || id < 0 ? null : manager.getUriForDownloadedFile(id);
        if (uri == null) {
            // 进程重启后下载 id 会丢，改用自带的只读 Provider
            uri = UpdateFileProvider.uriFor(activity.getPackageName());
        }
        Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(intent);
            return "installing";
        } catch (Exception e) {
            return "noinstaller";
        }
    }

    /** 当前是否已有校验通过的安装包 */
    String state() {
        File apk = apkFile();
        if (apk.isFile() && verify(apk) == null) {
            return "ready";
        }
        return downloadId >= 0 ? "downloading" : "idle";
    }

    /** 校验包名、版本号与签名，返回 null 表示通过 */
    private String verify(File apk) {
        if (apk == null || !apk.isFile()) {
            return "安装包不存在";
        }
        PackageManager pm = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
        PackageInfo remote;
        try {
            remote = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        } catch (Exception e) {
            return "无法读取安装包";
        }
        if (remote == null) {
            return "安装包解析失败";
        }
        if (!activity.getPackageName().equals(remote.packageName)) {
            return "安装包与当前应用不匹配";
        }
        long remoteCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? remote.getLongVersionCode()
                : remote.versionCode;
        if (remoteCode <= BuildConfig.VERSION_CODE) {
            return "安装包版本不比当前新";
        }
        Signature[] mine;
        Signature[] theirs;
        try {
            mine = signatures(pm.getPackageInfo(activity.getPackageName(), flags));
        } catch (Exception e) {
            return "无法读取本应用签名";
        }
        theirs = signatures(remote);
        if (mine == null || theirs == null || mine.length == 0 || theirs.length == 0) {
            return "签名信息缺失";
        }
        if (!Arrays.equals(mine[0].toByteArray(), theirs[0].toByteArray())) {
            return "签名校验失败，安装包可能被替换";
        }
        return null;
    }

    private Signature[] signatures(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        }
        return info.signatures;
    }

    private void openUnknownSourcesSettings() {
        try {
            activity.startActivity(new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())));
        } catch (Exception ignored) {
            // 个别 ROM 没有该页面，用户可自行去系统设置里开启
        }
    }

    private File apkFile() {
        File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return new File(dir == null ? activity.getFilesDir() : dir, APK_NAME);
    }

    /** 通知网页当前状态：idle / downloading / ready / error */
    private void emit(String state, String message) {
        if (webView == null) {
            return;
        }
        JSONObject payload = new JSONObject();
        try {
            payload.put("state", state);
            payload.put("message", message == null ? "" : message);
        } catch (Exception ignored) {
            return;
        }
        String script = "window.__hostUpdate&&window.__hostUpdate(" + JSONObject.quote(payload.toString()) + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }
}
