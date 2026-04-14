//! CloudBridgeService — NOT YET IMPLEMENTED. All methods return Err.

use std::collections::HashMap;

use crate::cloud_types::{BridgeConnection, BridgeConnectionState, BridgeMessage};

const NOT_IMPLEMENTED_MSG: &str =
    "CloudBridgeService requires a WebSocket backend. See docs for setup.";

/// WebSocket bridge to cloud-hosted ElizaOS agents.
///
/// **Status: NOT YET IMPLEMENTED.**
///
/// All connection and messaging methods return `Err`.  A functional
/// version requires a cloud WebSocket backend that speaks JSON-RPC 2.0.
pub struct CloudBridgeService {
    _private: (),
}

impl Default for CloudBridgeService {
    fn default() -> Self {
        Self::new()
    }
}

impl CloudBridgeService {
    pub fn new() -> Self {
        Self { _private: () }
    }

    pub async fn start(&mut self) -> Result<(), String> {
        Err(NOT_IMPLEMENTED_MSG.to_string())
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        Err(NOT_IMPLEMENTED_MSG.to_string())
    }

    // ─── Connection Management ─────────────────────────────────────────────

    pub async fn connect(&mut self, _container_id: &str) -> Result<(), String> {
        Err(NOT_IMPLEMENTED_MSG.to_string())
    }

    pub async fn disconnect(&mut self, _container_id: &str) -> Result<(), String> {
        Err(NOT_IMPLEMENTED_MSG.to_string())
    }

    // ─── Messaging ─────────────────────────────────────────────────────────

    pub fn build_request(
        &mut self,
        _container_id: &str,
        _method: &str,
        _params: HashMap<String, serde_json::Value>,
    ) -> Result<BridgeMessage, String> {
        Err(NOT_IMPLEMENTED_MSG.to_string())
    }

    /// Attempt to build a notification message — always fails (not implemented).
    pub fn build_notification(
        &self,
        _container_id: &str,
        _method: &str,
        _params: HashMap<String, serde_json::Value>,
    ) -> Result<BridgeMessage, String> {
        Err(NOT_IMPLEMENTED_MSG.to_string())
    }

    // ─── Accessors ─────────────────────────────────────────────────────────

    pub fn connection_state(&self, _container_id: &str) -> BridgeConnectionState {
        BridgeConnectionState::Disconnected
    }

    pub fn connection_info(&self, _container_id: &str) -> Option<BridgeConnection> {
        None
    }

    pub fn connected_container_ids(&self) -> Vec<String> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_returns_disconnected() {
        let svc = CloudBridgeService::new();
        assert_eq!(
            svc.connection_state("c-1"),
            BridgeConnectionState::Disconnected
        );
        assert!(svc.connection_info("c-1").is_none());
        assert!(svc.connected_container_ids().is_empty());
    }

    #[tokio::test]
    async fn test_connect_returns_err() {
        let mut svc = CloudBridgeService::new();
        let err = svc.connect("c-1").await.unwrap_err();
        assert!(err.contains("WebSocket backend"), "got: {err}");
    }

    #[tokio::test]
    async fn test_start_returns_err() {
        let mut svc = CloudBridgeService::new();
        let err = svc.start().await.unwrap_err();
        assert!(err.contains("WebSocket backend"), "got: {err}");
    }

    #[test]
    fn test_build_request_returns_err() {
        let mut svc = CloudBridgeService::new();
        assert!(svc
            .build_request("c-1", "message.send", HashMap::new())
            .is_err());
    }

    #[test]
    fn test_build_notification_returns_err() {
        let svc = CloudBridgeService::new();
        assert!(svc
            .build_notification("c-1", "heartbeat", HashMap::new())
            .is_err());
    }
}
