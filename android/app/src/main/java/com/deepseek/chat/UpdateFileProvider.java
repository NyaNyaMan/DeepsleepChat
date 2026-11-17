package com.deepseek.chat;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 把下载好的更新包暴露给系统安装器。
 *
 * <p>项目没有引入 AndroidX，用不了 FileProvider，这里只实现读文件这一个用途：
 * 授权交给调用方的 FLAG_GRANT_READ_URI_PERMISSION，Provider 本身不导出。
 */
public class UpdateFileProvider extends ContentProvider {

    static final String FILE_NAME = "chat-update.apk";
    private static final String MIME = "application/vnd.android.package-archive";

    static Uri uriFor(String packageName) {
        return new Uri.Builder()
                .scheme("content")
                .authority(packageName + ".update")
                .appendPath(FILE_NAME)
                .build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (getContext() == null) {
            throw new FileNotFoundException("no context");
        }
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File file = new File(dir == null ? getContext().getFilesDir() : dir, FILE_NAME);
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return MIME;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs,
                        String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
