package ph.doorbell.gate

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

// Runs once when the app starts, before any screen: connects to Firebase.
// (We set the project here in code instead of using a google-services.json file.)
class GateApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (FirebaseApp.getApps(this).isEmpty()) {
            val options = FirebaseOptions.Builder()
                .setApiKey(GateConfig.API_KEY)
                .setApplicationId(GateConfig.APP_ID)
                .setProjectId(GateConfig.PROJECT_ID)
                .setStorageBucket(GateConfig.STORAGE_BUCKET)
                .setGcmSenderId(GateConfig.SENDER_ID)
                .build()
            FirebaseApp.initializeApp(this, options)
        }
    }
}
