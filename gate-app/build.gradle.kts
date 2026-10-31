// Top-level build file. The app itself is configured in app/build.gradle.kts.
plugins {
    alias(libs.plugins.android.application) apply false
    // Not applied: this only picks the Kotlin version (Firebase 35 needs Kotlin 2.4 or newer).
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
