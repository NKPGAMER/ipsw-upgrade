use crate::downloader::types::Task;
use tokio::sync::broadcast;

#[derive(Debug, Clone)]
pub enum Event {
    Started {
        task_id: String,
        task: Task,
    },
    Progress {
        task_id: String,
        task: Task,
    },
    Completed {
        task_id: String,
        task: Task,
    },
    Error {
        task_id: String,
        error: String,
        task: Task,
    },
    Paused {
        task_id: String,
        task: Task,
    },
    Resumed {
        task_id: String,
        task: Task,
    },
    Added {
        task_id: String,
        task: Task,
    },
    Cancelled {
        task_id: String,
    },
    IncompleteDeleted {
        id: String,
    },
    BudgetChanged {
        task_id: String,
        connections: u32,
    },
}

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<Event>,
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(1024);
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.tx.subscribe()
    }

    pub fn emit(&self, event: Event) {
        let _ = self.tx.send(event);
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}
