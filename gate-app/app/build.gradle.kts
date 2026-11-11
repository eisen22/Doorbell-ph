// How the app is built: Android settings and the libraries it uses.
import java.util.Properties

// The gate account the app signs in with by itself (no sign-in screen). It is read from
// gate-app/local.properties, which is never uploaded to GitHub:
//   gate.email=gate@yourschool.ph
//   gate.password=the account's password
val localProps = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun quoted(key: String) = "\"" + (localProps.getProperty(key) ?: "").replace("\\", "\\\\").replace("\"", "\\\"") + "\""

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "ph.doorbell.gate"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "ph.doorbell.gate"
        minSdk = 26 // Android 8.0: needed for java.time (dates in the Philippine time zone)
        targetSdk = 37
        versionCode = 2
        versionName = "1.1"
        buildConfigField("String", "GATE_EMAIL", quoted("gate.email"))
        buildConfigField("String", "GATE_PASSWORD", quoted("gate.password"))
    }

    buildTypes {
        release {
            optimization {
                enable = false
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    // Screens (Jetpack Compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Firebase: sign-in and the Doorbell database (same project as the website)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.kotlinx.coroutines.play.services) // lets us `await()` Firebase tasks

    // Camera + barcode/QR reading (works offline, on the phone)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)
    implementation(libs.mlkit.barcode)

    // Tests for the attendance rules (app/src/test)
    testImplementation(libs.junit)
}
