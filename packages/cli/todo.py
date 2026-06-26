import json
import sys
import os

TODO_FILE = 'todos.json'

def load_todos():
    if not os.path.exists(TODO_FILE):
        return []
    with open(TODO_FILE, 'r') as f:
        return json.load(f)

def save_todos(todos):
    with open(TODO_FILE, 'w') as f:
        json.dump(todos, f, indent=2)

def add_todo(task):
    todos = load_todos()
    todos.append({'task': task, 'done': False})
    save_todos(todos)
    print(f'Added: {task}')

def list_todos():
    todos = load_todos()
    for idx, t in enumerate(todos, 1):
        status = '[x]' if t['done'] else '[ ]'
        print(f'{idx}. {status} {t["task"]}')

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'add':
        add_todo(' '.join(sys.argv[2:]))
    else:
        list_todos()