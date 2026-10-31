package ph.doorbell.gate.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import ph.doorbell.gate.R

// =====================================================================
// SignInScreen.kt — THE GATE PHONE SIGNS IN ONCE
// The admin makes the gate account on the website: Settings & SMS -> Gate scanner phone.
// After that the phone stays signed in, even after a restart.
// =====================================================================
@Composable
fun SignInScreen(busy: Boolean, error: String?, onSignIn: (String, String) -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }

    Box(
        Modifier
            .fillMaxSize()
            .background(Doorbell.canvas)
            .safeDrawingPadding()
            .imePadding(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Logo(48)
                Spacer(Modifier.size(12.dp))
                Text("Doorbell Gate", style = MaterialTheme.typography.titleLarge)
            }
            Spacer(Modifier.height(20.dp))
            Text("Sign in the gate phone", style = MaterialTheme.typography.headlineMedium)
            Text(
                "Use the gate account the school admin made in Settings & SMS. Children scan their ID here; teachers confirm attendance in the classroom.",
                style = MaterialTheme.typography.bodyMedium,
                color = Doorbell.muted,
            )
            Spacer(Modifier.height(4.dp))
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                shape = Radii.sm,
                colors = fieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onSignIn(email, password) }),
                trailingIcon = {
                    IconButton(onClick = { showPassword = !showPassword }) {
                        Icon(if (showPassword) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, contentDescription = if (showPassword) "Hide password" else "Show password")
                    }
                },
                shape = Radii.sm,
                colors = fieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
            if (error != null) Text(error, color = Doorbell.bad, style = MaterialTheme.typography.bodyMedium)
            Button(
                onClick = { onSignIn(email, password) },
                enabled = !busy,
                shape = Radii.sm,
                colors = ButtonDefaults.buttonColors(containerColor = Doorbell.ink, contentColor = Doorbell.frame),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp),
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(22.dp), color = Doorbell.frame, strokeWidth = 2.5.dp)
                else Text("Sign in", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Doorbell.ink,
    unfocusedBorderColor = Doorbell.line,
    focusedContainerColor = Doorbell.frame,
    unfocusedContainerColor = Doorbell.frame,
    focusedLabelColor = Doorbell.ink,
)

/** The Doorbell logo: the mark on its lime tile. */
@Composable
fun Logo(sizeDp: Int) {
    Box(
        Modifier
            .size(sizeDp.dp)
            .clip(SquircleShape((sizeDp * 0.23f).dp))
            .background(Doorbell.lime),
        contentAlignment = Alignment.Center,
    ) {
        Image(painterResource(R.drawable.doorbell_mark), contentDescription = null, modifier = Modifier.size((sizeDp * 0.75f).dp))
    }
}
