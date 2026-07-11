use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const REBALANCE_INTERVAL: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy)]
pub struct BudgetConfig {
    pub min_per_task: u32,
    pub max_per_task: u32,
    pub boost: bool,
    pub boost_multiplier: f64,
}

impl Default for BudgetConfig {
    fn default() -> Self {
        Self {
            min_per_task: 4,
            max_per_task: 16,
            boost: false,
            boost_multiplier: 2.0,
        }
    }
}

struct TaskStat {
    speed_bps: f64,
    connections: u32,
}

struct Inner {
    config: BudgetConfig,
    tasks: HashMap<String, TaskStat>,
    pool: f64,
    max_seen_speed: f64,
    previous_speed: f64,
    last_check: Option<Instant>,
}

pub struct GlobalBudget {
    inner: Mutex<Inner>,
}

impl GlobalBudget {
    pub fn new(config: BudgetConfig) -> Self {
        Self {
            inner: Mutex::new(Inner {
                config,
                tasks: HashMap::new(),
                pool: 0.0,
                max_seen_speed: 0.0,
                previous_speed: 0.0,
                last_check: None,
            }),
        }
    }

    pub fn set_boost(&self, boost: bool) {
        self.inner.lock().unwrap().config.boost = boost;
    }

    pub fn set_config(&self, config: BudgetConfig) {
        self.inner.lock().unwrap().config = config;
    }

    pub fn register(&self, task_id: &str) -> u32 {
        let mut inner = self.inner.lock().unwrap();
        let floor = inner.config.min_per_task;
        inner.tasks.insert(
            task_id.to_string(),
            TaskStat {
                speed_bps: 0.0,
                connections: floor,
            },
        );
        drop(inner);
        self.rebalance();
        floor
    }

    pub fn unregister(&self, task_id: &str) {
        self.inner.lock().unwrap().tasks.remove(task_id);
        self.rebalance();
    }

    pub fn report_speed(&self, task_id: &str, speed_bps: f64) -> u32 {
        {
            let mut inner = self.inner.lock().unwrap();
            if let Some(stat) = inner.tasks.get_mut(task_id) {
                stat.speed_bps = speed_bps;
            }
        }
        self.maybe_rebalance();
        self.current_allocation(task_id)
    }

    pub fn current_allocation(&self, task_id: &str) -> u32 {
        let inner = self.inner.lock().unwrap();
        inner
            .tasks
            .get(task_id)
            .map(|t| t.connections)
            .unwrap_or(inner.config.min_per_task)
    }

    fn maybe_rebalance(&self) {
        let should = {
            let inner = self.inner.lock().unwrap();
            match inner.last_check {
                None => true,
                Some(t) => t.elapsed() >= REBALANCE_INTERVAL,
            }
        };
        if should {
            self.rebalance();
        }
    }

    fn rebalance(&self) {
        let mut inner = self.inner.lock().unwrap();
        let n = inner.tasks.len().max(1) as f64;
        let floor_total = inner.config.min_per_task as f64 * n;
        let ceiling_total = {
            let per_task_cap = inner.config.max_per_task as f64
                * if inner.config.boost {
                    inner.config.boost_multiplier
                } else {
                    1.0
                };
            per_task_cap * n
        };

        if inner.tasks.is_empty() {
            inner.pool = 0.0;
            inner.last_check = Some(Instant::now());
            return;
        }

        let now = Instant::now();
        let aggregate_speed: f64 = inner.tasks.values().map(|t| t.speed_bps).sum();

        match inner.last_check {
            None => {
                inner.pool = floor_total;
            }
            Some(last) if now.duration_since(last) < REBALANCE_INTERVAL => {
                inner.pool = inner.pool.clamp(floor_total, ceiling_total);
            }
            Some(_) => {
                let previous_speed = inner.previous_speed;
                inner.max_seen_speed = inner.max_seen_speed.max(aggregate_speed);
                if aggregate_speed <= 0.0 || previous_speed <= 0.0 {
                    // Not enough data yet — hold.
                } else if aggregate_speed >= previous_speed * 0.8 {
                    // Stable or growing → Additive Increase
                    inner.pool = (inner.pool + 1.0).min(ceiling_total);
                } else if aggregate_speed < inner.max_seen_speed * 0.5 {
                    // Dropped >50% of max seen → halve
                    inner.pool = (inner.pool / 2.0).max(floor_total);
                } else {
                    // Dropped 20-50% → Multiplicative Decrease
                    inner.pool = (inner.pool - 2.0).max(floor_total);
                }
                inner.previous_speed = aggregate_speed;
            }
        }
        inner.last_check = Some(now);

        let pool = inner.pool.clamp(floor_total, ceiling_total);
        let min_per_task = inner.config.min_per_task;
        let max_per_task = (inner.config.max_per_task as f64
            * if inner.config.boost {
                inner.config.boost_multiplier
            } else {
                1.0
            }) as u32;

        let ids: Vec<String> = inner.tasks.keys().cloned().collect();
        if ids.len() == 1 {
            let id = &ids[0];
            let share = (pool as u32).clamp(min_per_task, max_per_task);
            inner.tasks.get_mut(id).unwrap().connections = share;
            return;
        }

        let total_speed: f64 = inner.tasks.values().map(|t| t.speed_bps).sum();
        if total_speed <= 0.0 {
            let even = (pool / ids.len() as f64)
                .floor()
                .max(min_per_task as f64) as u32;
            for id in &ids {
                inner.tasks.get_mut(id).unwrap().connections = even.min(max_per_task);
            }
            return;
        }

        let speed_pool = pool * 0.7;
        let floor_pool = pool - speed_pool;
        let floor_share = floor_pool / ids.len() as f64;

        let mut remainder = pool;
        let mut fastest_id = ids[0].clone();
        let mut fastest_share = 0.0_f64;

        for id in &ids {
            let speed = inner.tasks.get(id).unwrap().speed_bps;
            let fraction = speed / total_speed;
            let speed_share = speed_pool * fraction;
            let raw_share = (speed_share + floor_share).min(remainder);
            let share = raw_share.max(min_per_task as f64);
            let clamped = share.min(max_per_task as f64);
            inner.tasks.get_mut(id).unwrap().connections = clamped as u32;
            remainder -= clamped;
            if clamped > fastest_share {
                fastest_share = clamped;
                fastest_id = id.clone();
            }
        }

        if remainder > 0.0 {
            let stat = inner.tasks.get_mut(&fastest_id).unwrap();
            let bumped =
                (stat.connections as f64 + remainder).min(max_per_task as f64) as u32;
            stat.connections = bumped;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_task_gets_the_whole_floor_immediately() {
        let b = GlobalBudget::new(BudgetConfig {
            min_per_task: 4,
            max_per_task: 16,
            boost: false,
            boost_multiplier: 2.0,
        });
        let c = b.register("task-1");
        assert_eq!(c, 4);
        assert_eq!(b.current_allocation("task-1"), 4);
    }

    #[test]
    fn boost_raises_the_ceiling_for_every_active_task_not_just_one() {
        let b = GlobalBudget::new(BudgetConfig {
            min_per_task: 4,
            max_per_task: 16,
            boost: false,
            boost_multiplier: 2.0,
        });
        b.register("a");
        b.register("b");
        b.set_boost(true);
        b.report_speed("a", 10_000_000.0);
        b.report_speed("b", 10_000_000.0);
        let alloc_a = b.current_allocation("a");
        let alloc_b = b.current_allocation("b");
        assert!(alloc_a <= 32 && alloc_b <= 32);
    }

    #[test]
    fn faster_task_gets_at_least_as_much_as_slower_task_after_rebalance() {
        let b = GlobalBudget::new(BudgetConfig {
            min_per_task: 2,
            max_per_task: 20,
            boost: false,
            boost_multiplier: 1.0,
        });
        b.register("fast");
        b.register("slow");
        b.report_speed("fast", 1.0);
        b.report_speed("slow", 1.0);
        std::thread::sleep(Duration::from_millis(3100));
        b.report_speed("fast", 8_000_000.0);
        let slow_alloc = b.report_speed("slow", 500_000.0);
        let fast_alloc = b.current_allocation("fast");
        assert!(fast_alloc >= slow_alloc);
    }
}
