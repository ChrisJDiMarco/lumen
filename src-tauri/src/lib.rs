pub const DEFAULT_WIDTH: f64 = 1440.0;
pub const DEFAULT_HEIGHT: f64 = 900.0;
pub const MIN_WIDTH: f64 = 1024.0;
pub const MIN_HEIGHT: f64 = 700.0;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Lumen failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_window_exceeds_the_supported_gameplay_minimum() {
        let dimensions =
            std::hint::black_box((DEFAULT_WIDTH, DEFAULT_HEIGHT, MIN_WIDTH, MIN_HEIGHT));
        assert!(dimensions.0 >= dimensions.2);
        assert!(dimensions.1 >= dimensions.3);
        assert_eq!(dimensions.0 / dimensions.1, 1.6);
    }
}
