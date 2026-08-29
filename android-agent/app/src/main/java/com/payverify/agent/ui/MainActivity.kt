package com.payverify.agent.ui

import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.payverify.agent.AgentApplication
import com.payverify.agent.ui.activity.ActivityScreen
import com.payverify.agent.ui.dashboard.DashboardScreen
import com.payverify.agent.ui.evidencedetail.EvidenceDetailScreen
import com.payverify.agent.ui.permission.PermissionSetupScreen

class MainActivity : ComponentActivity() {

    private val viewModel: AgentViewModel by viewModels {
        val app = application as AgentApplication
        AgentViewModel.Factory(this, app.db, app.secureStorage)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AgentTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    AppNavigation(viewModel)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // تحديث حالة الصلاحيات عند العودة من الإعدادات
        viewModel.refreshStatus()
    }
}

// ─── Navigation ───────────────────────────────────────────
@Composable
private fun AppNavigation(viewModel: AgentViewModel) {
    val navController = rememberNavController()
    val context = LocalContext.current

    // تحقق من حالة Notification Listener
    val isListenerEnabled = remember {
        mutableStateOf(isNotificationListenerEnabled(context))
    }

    // تحديث عند التنقل
    LaunchedEffect(navController) {
        navController.addOnDestinationChangedListener { _, dest, _ ->
            isListenerEnabled.value = isNotificationListenerEnabled(context)
        }
    }

    NavHost(
        navController = navController,
        startDestination = if (isListenerEnabled.value) Routes.DASHBOARD else Routes.PERMISSION
    ) {
        composable(Routes.PERMISSION) {
            PermissionSetupScreen(
                isListenerEnabled = isListenerEnabled.value,
                onContinue = {
                    navController.navigate(Routes.DASHBOARD) {
                        popUpTo(Routes.PERMISSION) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.DASHBOARD) {
            DashboardScreen(
                viewModel            = viewModel,
                onNavigateToActivity = { navController.navigate(Routes.ACTIVITY) }
            )
        }

        composable(Routes.ACTIVITY) {
            ActivityScreen(
                viewModel        = viewModel,
                onEvidenceClick  = { id -> navController.navigate("${Routes.EVIDENCE_DETAIL}/$id") },
                onBack           = { navController.popBackStack() }
            )
        }

        composable(
            route     = "${Routes.EVIDENCE_DETAIL}/{evidenceId}",
            arguments = listOf(navArgument("evidenceId") { type = NavType.StringType })
        ) { backStack ->
            val evidenceId = backStack.arguments?.getString("evidenceId") ?: return@composable
            val app = context.applicationContext as AgentApplication
            EvidenceDetailScreen(
                evidenceId = evidenceId,
                db         = app.db,
                onBack     = { navController.popBackStack() }
            )
        }
    }
}

private fun isNotificationListenerEnabled(context: android.content.Context): Boolean {
    val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
    return flat?.contains(context.packageName) == true
}

object Routes {
    const val PERMISSION       = "permission"
    const val DASHBOARD        = "dashboard"
    const val ACTIVITY         = "activity"
    const val EVIDENCE_DETAIL  = "evidence_detail"
}

// ─── Theme ────────────────────────────────────────────────
@Composable
fun AgentTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = if (dark) darkColorScheme() else lightColorScheme()
    MaterialTheme(colorScheme = colors, content = content)
}
