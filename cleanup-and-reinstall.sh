#!/bin/bash

echo "Cleaning up failed installation..."
rm -rf node_modules
rm -rf .next
echo "Reinstalling dependencies..."
npm install
echo "Cleanup complete" 