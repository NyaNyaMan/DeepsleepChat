# 反射调用（@JavascriptInterface）不能被裁剪
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.deepseek.chat.** { *; }
