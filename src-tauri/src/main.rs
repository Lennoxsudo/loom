// Prevents additional console window on Windows in release, DO NOT REMOVE!!
// Temporarily commented out to debug production build issues
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    loom_lib::run()
}
