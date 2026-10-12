// Release builds must not open a console window next to the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    fogwarden_lib::run()
}
